import { createHash } from "node:crypto";
import type { FetchMessageObject, ImapFlow, MessageStructureObject } from "imapflow";
import type { Address, ThreadList, ThreadSummary } from "@ionnet/shared";
import { badRequest } from "../errors.ts";

const PAGE = 50;

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
  // Subject fallback: messages with identical normalized subject and no id links.
  const bySubject = new Map<string, string>();
  for (const e of envs) {
    const s = normalizeSubject(e.subject);
    if (!s) continue;
    const linked = e.references.length > 0 || !!e.inReplyTo;
    if (linked) continue;
    const other = bySubject.get(s);
    if (other) union(e.messageId, other);
    else bySubject.set(s, e.messageId);
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

export async function fetchEnvelopes(client: ImapFlow, uids: number[]): Promise<Envelope[]> {
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

/** UIDs of all messages in `folder` belonging to the thread rooted at `rootMessageId`. */
export async function threadUids(client: ImapFlow, folder: string, rootMessageId: string): Promise<number[]> {
  const lock = await client.getMailboxLock(folder);
  try {
    const found = await client.search(
      {
        or: [
          { header: { "message-id": rootMessageId } },
          { header: { references: rootMessageId } },
          { header: { "in-reply-to": rootMessageId } },
        ],
      },
      { uid: true },
    );
    return (found || []).sort((a, b) => a - b);
  } finally {
    lock.release();
  }
}
