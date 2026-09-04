import { logger } from "../logger.ts";

const log = logger("publicip");
let cached: { ip: string | null; at: number } = { ip: null, at: 0 };
const TTL = 3600_000;

export async function getPublicIp(force = false): Promise<string | null> {
  if (!force && cached.ip && Date.now() - cached.at < TTL) return cached.ip;
  for (const url of ["https://api.ipify.org?format=json", "https://api4.ipify.org?format=json"]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { ip?: string };
      if (data.ip) {
        cached = { ip: data.ip, at: Date.now() };
        return data.ip;
      }
    } catch (err) {
      log.debug(`lookup via ${url} failed: ${(err as Error).message}`);
    }
  }
  return cached.ip;
}
