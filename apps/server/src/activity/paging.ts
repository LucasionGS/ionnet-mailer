import type { Page } from "@ionnet/shared";

/** `rows` were fetched newest first with `limit + 1`; the extra row only signals that there is a next page. */
export function pageOf<R extends { id: string }, T>(rows: R[], limit: number, map: (r: R) => T): Page<T> {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { items: items.map(map), nextCursor: more ? String(items[items.length - 1]!.id) : null };
}

/** A `%…%` ILIKE pattern that matches `q` literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Parses the shared `?limit=&before=` query parameters. */
export function pageParams(query: (k: string) => string | undefined, max = 200): { limit: number; before?: string } {
  const limit = Math.min(Math.max(Number(query("limit")) || 50, 1), max);
  const before = query("before");
  return { limit, ...(before && /^\d+$/.test(before) ? { before } : {}) };
}
