import { Resolver } from "node:dns/promises";

/** Public resolvers so results reflect what the world sees, not a cached local view. */
export function publicResolver(): Resolver {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return r;
}

export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function txt(r: Resolver, name: string): Promise<string[]> {
  const rows = await safe(r.resolveTxt(name), [] as string[][]);
  return rows.map((chunks) => chunks.join(""));
}
