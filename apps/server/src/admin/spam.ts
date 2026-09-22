import type { SpamHistory, SpamScan } from "@ionnet/shared";
import { config } from "../config.ts";

interface RspamdSymbol {
  name?: string;
  score?: number;
  description?: string;
  options?: string[];
}
interface RspamdRow {
  "message-id"?: string;
  unix_time?: number;
  ip?: string;
  sender_mime?: string;
  sender_smtp?: string;
  rcpt_mime?: string[];
  rcpt_smtp?: string[];
  subject?: string;
  action?: string;
  score?: number;
  required_score?: number;
  size?: number;
  user?: string;
  symbols?: Record<string, RspamdSymbol>;
}

function toScan(r: RspamdRow, i: number): SpamScan {
  const symbols = Object.values(r.symbols ?? {})
    .filter((s) => typeof s.score === "number" && s.score !== 0)
    .sort((a, b) => Math.abs(b.score!) - Math.abs(a.score!))
    .map((s) => ({ name: s.name ?? "", score: Math.round(s.score! * 100) / 100, description: s.description ?? null, options: (s.options ?? []).slice(0, 5) }));
  const time = new Date((r.unix_time ?? 0) * 1000);
  return {
    id: `${r["message-id"] ?? "no-id"}:${r.unix_time ?? 0}:${i}`,
    time: time.toISOString(),
    ip: r.ip && r.ip !== "unknown" ? r.ip : null,
    from: r.sender_mime || r.sender_smtp || "",
    to: (r.rcpt_mime?.length ? r.rcpt_mime : (r.rcpt_smtp ?? [])).slice(0, 20),
    subject: r.subject ?? "",
    action: r.action ?? "",
    score: Math.round((r.score ?? 0) * 100) / 100,
    requiredScore: r.required_score ?? 0,
    size: r.size ?? 0,
    user: r.user && r.user !== "unknown" ? r.user : null,
    symbols,
  };
}

/** rspamd keeps its last few hundred scans (history_redis); newest first. */
export async function spamHistory(): Promise<SpamHistory> {
  try {
    const res = await fetch(`${config.RSPAMD_URL}/history`, {
      headers: config.RSPAMD_PASSWORD ? { Password: config.RSPAMD_PASSWORD } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { available: false, scans: [] };
    const body = (await res.json()) as { rows?: RspamdRow[] } | RspamdRow[];
    const rows = Array.isArray(body) ? body : (body.rows ?? []);
    return { available: true, scans: rows.map(toScan).sort((a, b) => b.time.localeCompare(a.time)) };
  } catch {
    return { available: false, scans: [] };
  }
}
