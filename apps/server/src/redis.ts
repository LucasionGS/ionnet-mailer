import { Redis } from "ioredis";
import { config } from "./config.ts";

let client: Redis | null = null;
export function redis(): Redis {
  if (!client) {
    client = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: true });
    client.on("error", (err) => console.error("redis error", err.message));
  }
  return client;
}
export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
