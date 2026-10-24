import { createHash } from "node:crypto";
import type { FetchMessageObject, ImapFlow, MessageStructureObject, SearchObject } from "imapflow";
import type { Address, ThreadList, ThreadSummary } from "@ionnet/shared";
import { badRequest } from "../errors.ts";

const PAGE = 50;
/** Unlinked messages sharing subject and sender are only merged when sent at most this far apart. */
const SUBJECT_FALLBACK_GAP_MS = 14 * 24 * 60 * 60 * 1000;
/** Upper bound on search rounds when collecting a thread, so a pathological reference graph can't loop forever. */
const MAX_EXPAND_ROUNDS = 8;
/** Max ids/subjects per IMAP SEARCH, keeps the OR tree a reasonable size. */
const SEARCH_CHUNK = 25;

const normalizeSubject = (s: string | undefined) =>
  (s ?? "")
    .replace(/^\s*((re|fwd?|aw|wg|sv|vs)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const tidy = (id: string | undefined | null) => (id ?? "").trim();

export function threadIdFor(rootMessageId: string): string {
  return Buffer.from(rootMessageId).toString("base64url");
}
export function rootFromThreadId(threadId: string): string {
  try {
    return Buffer.from(threadId, "base64url").toString("utf8");
  } catch {
    throw badRequest("Invalid thread id");
  }
}

function hasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(hasAttachment);
  if (node.disposition?.toLowerCase() === "attachment") return true;
  const t = node.type.toLowerCase();
  return !t.startsWith("text/") && !t.startsWith("multipart/") && node.disposition?.toLowerCase() !== "inline";
}

function addr(a: { name?: string; address?: string } | undefined): Address | null {
  if (!a?.address) return null;
  return { name: a.name ?? "", address: a.address };
}

export interface Envelope {
  uid: number;
  messageId: string;
  inReplyTo: string;
  references: string[];
  subject: string;
  date: Date;
  from: Address | null;
  to: Address[];
  flags: Set<string>;
  hasAttachments: boolean;
  snippet: string;
}

export function toEnvelope(m: FetchMessageObject, references: string[] = []): Envelope {
  const env = m.envelope ?? {};
  return {
    uid: m.uid,
    messageId: tidy(env.messageId) || `<uid-${m.uid}@local>`,
    inReplyTo: tidy(env.inReplyTo),
    references,
    subject: env.subject ?? "",
    date: env.date ? new Date(env.date) : m.internalDate ? new Date(m.internalDate) : new Date(0),
    from: addr(env.from?.[0]),
    to: (env.to ?? []).map(addr).filter((x): x is Address => !!x),
    flags: m.flags ?? new Set(),
    hasAttachments: hasAttachment(m.bodyStructure),
    snippet: "",
  };
}

function parseReferencesHeader(headers: Buffer | undefined): string[] {
  if (!headers) return [];
  const text = headers.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  const line = text.split(/\r?\n/).find((l) => /^references:/i.test(l));
  return line ? (line.match(/<[^>]+>/g) ?? []) : [];
}

const isLinked = (e: Envelope) => e.references.length > 0 || !!e.inReplyTo;

/** Key used by the subject fallback, or null when the message is id-linked or has no subject. */
function subjectKey(e: Envelope): string | null {
  if (isLinked(e)) return null;
  const s = normalizeSubject(e.subject);
  if (!s) return null;
  return `${s}\n${e.from?.address.toLowerCase() ?? ""}`;
}

/** Groups envelopes into threads using Message-ID / References / In-Reply-To, then subject as a fallback. */
export function groupThreads(envs: Envelope[], folder: string): ThreadSummary[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const e of envs) {
    parent.set(e.messageId, parent.get(e.messageId) ?? e.messageId);
    for (const ref of [...e.references, e.inReplyTo].filter(Boolean)) {
      parent.set(ref, parent.get(ref) ?? ref);
      union(e.messageId, ref);
    }
  }
  // Subject fallback: messages with no id links, the same normalized subject and sender, sent close together.
  const lastBySubject = new Map<string, Envelope>();
  for (const e of [...envs].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const key = subjectKey(e);
    if (!key) continue;
    const prev = lastBySubject.get(key);
    if (prev && e.date.getTime() - prev.date.getTime() <= SUBJECT_FALLBACK_GAP_MS) union(e.messageId, prev.messageId);
    lastBySubject.set(key, e);
  }
  const groups = new Map<string, Envelope[]>();
  for (const e of envs) {
    const root = find(e.messageId);
    const list = groups.get(root) ?? [];
    list.push(e);
    groups.set(root, list);
  }
  const threads: ThreadSummary[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    const newest = list[list.length - 1]!;
    const oldest = list[0]!;
    const rootId = oldest.references[0] ?? oldest.messageId;
    const seen = new Set<string>();
    const participants: Address[] = [];
    for (const e of [...list].reverse()) {
      for (const a of [e.from, ...e.to]) {
        if (a && !seen.has(a.address.toLowerCase())) {
          seen.add(a.address.toLowerCase());
          participants.push(a);
        }
      }
    }
    threads.push({
      id: threadIdFor(rootId),
      folder,
      subject: newest.subject || oldest.subject || "(no subject)",
      participants,
      snippet: newest.snippet,
      date: newest.date.toISOString(),
      unread: list.some((e) => !e.flags.has("\\Seen")),
      flagged: list.some((e) => e.flags.has("\\Flagged")),
      answered: newest.flags.has("\\Answered"),
      hasAttachments: list.some((e) => e.hasAttachments),
      messageCount: list.length,
      uids: list.map((e) => e.uid),
    });
  }
  threads.sort((a, b) => b.date.localeCompare(a.date));
  return threads;
}

/** Locate the text leaf (prefer text/plain, else text/html) and its IMAP part id. */
function textLeaf(structure: MessageStructureObject | undefined): { key: string; node: MessageStructureObject } | null {
  if (!structure) return null;
  let html: { key: string; node: MessageStructureObject } | null = null;
  const walk = (node: MessageStructureObject): { key: string; node: MessageStructureObject } | null => {
    if (node.childNodes?.length) {
      for (const child of node.childNodes) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    const type = node.type.toLowerCase();
    if (node.disposition?.toLowerCase() === "attachment") return null;
    const key = node.part || "1";
    if (type === "text/plain") return { key, node };
    if (type === "text/html" && !html) html = { key, node };
    return null;
  };
  return walk(structure) ?? html;
}

/** Decode a truncated body part into preview text. */
function snippetFromPart(node: MessageStructureObject, raw: Buffer | undefined): string {
  if (!raw?.length) return "";
  const enc = (node.encoding ?? "").toLowerCase();
  const charset = (node.parameters?.charset ?? "utf-8").toLowerCase();
  let bytes: Buffer;
  if (enc === "base64") {
    bytes = Buffer.from(raw.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  } else if (enc === "quoted-printable") {
    bytes = Buffer.from(
      raw
        .toString("latin1")
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
      "latin1",
    );
  } else {
    bytes = raw;
  }
  let text: string;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = bytes.toString("utf8");
  }
  if (node.type.toLowerCase() === "text/html") {
    text = text
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

export async function fetchEnvelopes(client: ImapFlow, uids: number[], opts: { snippets?: boolean } = {}): Promise<Envelope[]> {
  if (!uids.length) return [];
  const out = new Map<number, Envelope>();
  const leaves = new Map<number, { key: string; node: MessageStructureObject }>();
  for await (const m of client.fetch(
    uids,
    { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true, headers: ["references"] },
    { uid: true },
  )) {
    out.set(m.uid, toEnvelope(m, parseReferencesHeader(m.headers)));
    const leaf = textLeaf(m.bodyStructure);
    if (leaf) leaves.set(m.uid, leaf);
  }
  if (opts.snippets === false) return uids.map((u) => out.get(u)).filter((e): e is Envelope => !!e);
  // Second pass: fetch a truncated copy of each message's text leaf, grouped by part id.
  const byKey = new Map<string, number[]>();
  for (const [uid, leaf] of leaves) byKey.set(leaf.key, [...(byKey.get(leaf.key) ?? []), uid]);
  for (const [key, group] of byKey) {
    for await (const m of client.fetch(group, { uid: true, bodyParts: [{ key, maxLength: 1200 }] }, { uid: true })) {
      const env = out.get(m.uid);
      const leaf = leaves.get(m.uid);
      if (env && leaf) env.snippet = snippetFromPart(leaf.node, m.bodyParts?.get(key));
    }
  }
  return uids.map((u) => out.get(u)).filter((e): e is Envelope => !!e);
}

export async function listThreads(
  client: ImapFlow,
  folder: string,
  opts: { cursor?: string; limit?: number; q?: string },
): Promise<ThreadList> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 200);
  const lock = await client.getMailboxLock(folder);
  try {
    const query = opts.q?.trim() ? { text: opts.q.trim() } : { all: true };
    const all = ((await client.search(query, { uid: true })) || []).sort((a, b) => a - b);
    const cursor = opts.cursor ? Number(opts.cursor) : Infinity;
    const eligible = all.filter((u) => u < cursor);
    const page = eligible.slice(-limit);
    const envs = await fetchEnvelopes(client, page);
    const threads = groupThreads(envs, folder);
    const oldest = page[0];
    const nextCursor = oldest !== undefined && eligible.length > page.length ? String(oldest) : null;
    return { folder, threads, nextCursor, total: all.length };
  } finally {
    lock.release();
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * UIDs of all messages in `folder` belonging to the thread rooted at `rootMessageId`.
 * Mirrors `groupThreads`: follows Message-ID / References / In-Reply-To links transitively and
 * applies the same subject fallback, so opening a thread shows every message the list grouped into it.
 */
export async function threadUids(client: ImapFlow, folder: string, rootMessageId: string): Promise<number[]> {
  const lock = await client.getMailboxLock(folder);
  try {
    const known = new Map<number, Envelope>();
    const searchedIds = new Set<string>();
    const searchedSubjects = new Set<string>();
    let ids = [rootMessageId];
    let subjects: string[] = [];
    for (let round = 0; round < MAX_EXPAND_ROUNDS && (ids.length || subjects.length); round++) {
      ids.forEach((id) => searchedIds.add(id));
      subjects.forEach((s) => searchedSubjects.add(s));
      const found = new Set<number>();
      for (const group of chunk(ids, SEARCH_CHUNK)) {
        const or = group.flatMap((id): SearchObject[] => [
          { header: { "message-id": id } },
          { header: { references: id } },
          { header: { "in-reply-to": id } },
        ]);
        for (const uid of (await client.search({ or }, { uid: true })) || []) found.add(uid);
      }
      for (const group of chunk(subjects, SEARCH_CHUNK)) {
        const or = group.map((subject) => ({ subject }));
        for (const uid of (await client.search({ or }, { uid: true })) || []) found.add(uid);
      }
      const fresh = [...found].filter((u) => !known.has(u)).sort((a, b) => a - b);
      const envs = await fetchEnvelopes(client, fresh, { snippets: false });
      envs.forEach((e) => known.set(e.uid, e));
      // Subject searches are loose substring matches; only messages that actually join the thread add new search terms.
      const members = new Set(threadOf([...known.values()], folder, rootMessageId));
      const nextIds = new Set<string>();
      const nextSubjects = new Set<string>();
      for (const e of known.values()) {
        if (!members.has(e.uid)) continue;
        for (const id of [e.messageId, e.inReplyTo, ...e.references]) if (id && !searchedIds.has(id)) nextIds.add(id);
        const s = subjectKey(e) ? normalizeSubject(e.subject) : "";
        if (s && !searchedSubjects.has(s)) nextSubjects.add(s);
      }
      ids = [...nextIds];
      subjects = [...nextSubjects];
    }
    return threadOf([...known.values()], folder, rootMessageId).sort((a, b) => a - b);
  } finally {
    lock.release();
  }
}

/** UIDs of the group in `envs` that contains (or references) `rootMessageId`. */
function threadOf(envs: Envelope[], folder: string, rootMessageId: string): number[] {
  const seeds = new Set(
    envs
      .filter((e) => e.messageId === rootMessageId || e.inReplyTo === rootMessageId || e.references.includes(rootMessageId))
      .map((e) => e.uid),
  );
  const thread = groupThreads(envs, folder).find((t) => t.uids.some((u) => seeds.has(u)));
  return thread?.uids ?? [];
}
