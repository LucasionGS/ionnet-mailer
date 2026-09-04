import type { ImapFlow } from "imapflow";
import type { Message } from "@ionnet/shared";
import { notFound } from "../errors.ts";
import { Lru } from "./lru.ts";
import { parseRaw, type ParsedMessage } from "./parse.ts";

const cache = new Lru<string, ParsedMessage>(50);
const key = (userId: string, folder: string, uid: number) => `${userId}:${folder}:${uid}`;

export async function fetchRaw(client: ImapFlow, folder: string, uid: number): Promise<{ raw: Buffer; flags: Set<string>; size: number }> {
  const lock = await client.getMailboxLock(folder);
  try {
    const m = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, size: true }, { uid: true });
    if (!m || !m.source) throw notFound("Message not found");
    return { raw: m.source, flags: m.flags ?? new Set(), size: m.size ?? m.source.length };
  } finally {
    lock.release();
  }
}

export async function loadMessage(client: ImapFlow, userId: string, folder: string, uid: number): Promise<ParsedMessage> {
  const k = key(userId, folder, uid);
  const hit = cache.get(k);
  if (hit) return hit;
  const { raw, flags, size } = await fetchRaw(client, folder, uid);
  const parsed = await parseRaw(raw, folder, uid, flags, size);
  cache.set(k, parsed);
  return parsed;
}

export function invalidate(userId: string, folder: string, uid: number) {
  cache.delete(key(userId, folder, uid));
}

export async function loadMessages(client: ImapFlow, userId: string, folder: string, uids: number[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const uid of uids) {
    try {
      out.push((await loadMessage(client, userId, folder, uid)).message);
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return out;
}
