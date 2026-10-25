import type { ImapFlow } from "imapflow";
import type { Message } from "@ionnet/shared";
import { notFound } from "../errors.ts";
import { lockFolder } from "./pool.ts";
import { Lru } from "./lru.ts";
import { parseRaw, type ParsedMessage } from "./parse.ts";

const cache = new Lru<string, ParsedMessage>(50);
const key = (userId: string, folder: string, uid: number) => `${userId}:${folder}:${uid}`;

export async function fetchRaw(client: ImapFlow, folder: string, uid: number): Promise<{ raw: Buffer; flags: Set<string>; size: number }> {
  const lock = await lockFolder(client, folder);
  try {
    const m = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, size: true }, { uid: true });
    if (!m || !m.source) throw notFound("Message not found");
    return { raw: m.source, flags: m.flags ?? new Set(), size: m.size ?? m.source.length };
  } finally {
    lock.release();
  }
}

function withFlags(parsed: ParsedMessage, flags: Set<string>): ParsedMessage {
  return {
    ...parsed,
    message: {
      ...parsed.message,
      flags: [...flags],
      unread: !flags.has("\\Seen"),
      flagged: flags.has("\\Flagged"),
      answered: flags.has("\\Answered"),
      draft: flags.has("\\Draft"),
    },
  };
}

/** Current flags of `uids`; other mail apps change them without telling this server's cache. */
async function fetchFlags(client: ImapFlow, folder: string, uids: number[]): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  if (!uids.length) return out;
  const lock = await lockFolder(client, folder);
  try {
    for await (const m of client.fetch(uids, { uid: true, flags: true }, { uid: true })) out.set(m.uid, m.flags ?? new Set());
  } finally {
    lock.release();
  }
  return out;
}

/** The parsed message, from the cache when possible; the body is cached, the flags are always read fresh. */
export async function loadMessage(client: ImapFlow, userId: string, folder: string, uid: number): Promise<ParsedMessage> {
  const k = key(userId, folder, uid);
  const hit = cache.get(k);
  if (hit) {
    const flags = (await fetchFlags(client, folder, [uid])).get(uid);
    if (!flags) {
      cache.delete(k);
      throw notFound("Message not found");
    }
    return withFlags(hit, flags);
  }
  const { raw, flags, size } = await fetchRaw(client, folder, uid);
  const parsed = await parseRaw(raw, folder, uid, flags, size);
  cache.set(k, parsed);
  return parsed;
}

export function invalidate(userId: string, folder: string, uid: number) {
  cache.delete(key(userId, folder, uid));
}

export async function loadMessages(client: ImapFlow, userId: string, folder: string, uids: number[]): Promise<Message[]> {
  const flags = await fetchFlags(client, folder, uids);
  const out: Message[] = [];
  for (const uid of uids) {
    const f = flags.get(uid);
    if (!f) continue; // expunged meanwhile
    const k = key(userId, folder, uid);
    const hit = cache.get(k);
    if (hit) {
      out.push(withFlags(hit, f).message);
      continue;
    }
    try {
      const { raw, size } = await fetchRaw(client, folder, uid);
      const parsed = await parseRaw(raw, folder, uid, f, size);
      cache.set(k, parsed);
      out.push(parsed.message);
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return out;
}
