import { redis } from "../redis.ts";
import type { Lockout } from "@ionnet/shared";

const WINDOW_S = 15 * 60;
const LOCK_S = 15 * 60;
const LIMITS = { ip: 20, user: 8 } as const;

type Kind = keyof typeof LIMITS;
const failKey = (kind: Kind, id: string) => `fail:${kind}:${id}`;
const lockKey = (kind: Kind, id: string) => `lock:${kind}:${id}`;

export async function isLocked(kind: Kind, id: string): Promise<number> {
  const ttl = await redis().ttl(lockKey(kind, id));
  return ttl > 0 ? ttl : 0;
}

/** Records a failure; returns seconds locked if the threshold is now exceeded. */
export async function recordFailure(kind: Kind, id: string): Promise<number> {
  const r = redis();
  const key = failKey(kind, id);
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, WINDOW_S);
  if (count >= LIMITS[kind]) {
    await r.set(lockKey(kind, id), String(count), "EX", LOCK_S);
    return LOCK_S;
  }
  return 0;
}

export async function clearFailures(kind: Kind, id: string): Promise<void> {
  await redis().del(failKey(kind, id), lockKey(kind, id));
}

export async function listLockouts(): Promise<Lockout[]> {
  const r = redis();
  const out: Lockout[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", "lock:*", "COUNT", 200);
    cursor = next;
    for (const k of keys) {
      const [attempts, ttl] = await Promise.all([r.get(k), r.ttl(k)]);
      out.push({
        key: k.slice("lock:".length),
        attempts: Number(attempts ?? 0),
        lockedUntil: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
      });
    }
  } while (cursor !== "0");
  return out;
}

export async function removeLockout(key: string): Promise<void> {
  const [kind, ...rest] = key.split(":");
  if (kind !== "ip" && kind !== "user") return;
  await clearFailures(kind, rest.join(":"));
}
