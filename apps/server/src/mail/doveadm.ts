import { createHash } from "node:crypto";
import { config } from "../config.ts";
import { HttpError, notFound } from "../errors.ts";

/**
 * Client for Dovecot's doveadm HTTP API (service doveadm, port 8080 on the
 * compose network). docker/dovecot/entrypoint.sh derives the same password
 * from the master password, so there is no extra secret to configure.
 */
function password(): string {
  return createHash("sha256").update(`doveadm:${config.DOVECOT_MASTER_PASSWORD}`).digest("hex").slice(0, 40);
}

// sysexits codes doveadm reports per command
const EX_NOUSER = 67;

type Reply = [string, unknown, string];

/** Runs several commands in one request; results come back in the same order. */
async function doveadm(commands: Array<[string, Record<string, unknown>]>): Promise<Array<unknown[] | { exitCode: number }>> {
  if (!commands.length) return [];
  let res: Response;
  try {
    res = await fetch(`${config.DOVEADM_URL}/doveadm/v1`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`doveadm:${password()}`).toString("base64")}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map(([cmd, params], i) => [cmd, params, String(i)])),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new HttpError(503, "doveadm_unavailable", `Dovecot's admin API is not reachable: ${(err as Error).message}`);
  }
  if (res.status === 401) throw new HttpError(502, "doveadm_auth", "Dovecot's admin API rejected the app. Recreate the dovecot container so it picks up doveadm_password.");
  if (!res.ok) throw new HttpError(502, "doveadm_error", `Dovecot's admin API answered ${res.status}`);
  const replies = (await res.json()) as Reply[];
  const byTag = new Map(replies.map((r) => [r[2], r]));
  return commands.map((_, i) => {
    const r = byTag.get(String(i));
    if (!r) return { exitCode: -1 };
    if (r[0] === "error") return { exitCode: Number((r[1] as { exitCode?: number })?.exitCode ?? -1) };
    return Array.isArray(r[1]) ? r[1] : [];
  });
}

export interface QuotaUsage {
  usedBytes: number;
  /** 0 = unlimited */
  limitBytes: number;
  messages: number;
}

interface QuotaRow {
  username?: string;
  type?: string;
  value?: string;
  limit?: string;
}

/** doveadm reports STORAGE in KiB; "-" means no limit. */
function toUsage(rows: QuotaRow[]): QuotaUsage {
  const storage = rows.find((r) => r.type === "STORAGE");
  const messages = rows.find((r) => r.type === "MESSAGE");
  const kib = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) * 1024 : 0);
  return { usedBytes: kib(storage?.value), limitBytes: kib(storage?.limit), messages: Number(messages?.value) || 0 };
}

/** Usage per address; mailboxes Dovecot doesn't know (yet) are left out. */
export async function quotaUsage(emails: string[]): Promise<Map<string, QuotaUsage>> {
  const results = await doveadm(emails.map((user) => ["quotaGet", { user }]));
  const out = new Map<string, QuotaUsage>();
  results.forEach((r, i) => {
    if (Array.isArray(r)) out.set(emails[i]!, toUsage(r as QuotaRow[]));
  });
  return out;
}

/** Usage of every active mailbox in one call. */
export async function quotaUsageAll(): Promise<Map<string, QuotaUsage>> {
  const [r] = await doveadm([["quotaGet", { allUsers: true }]]);
  const byUser = new Map<string, QuotaRow[]>();
  for (const row of Array.isArray(r) ? (r as QuotaRow[]) : []) {
    if (!row.username) continue;
    byUser.set(row.username, [...(byUser.get(row.username) ?? []), row]);
  }
  return new Map([...byUser].map(([u, rows]) => [u, toUsage(rows)]));
}

/** Recounts the mailbox's stored size, e.g. after the quota was changed or mail was moved on disk. */
export async function quotaRecalc(email: string): Promise<void> {
  const [r] = await doveadm([["quotaRecalc", { user: email }]]);
  if (r && !Array.isArray(r)) {
    if (r.exitCode === EX_NOUSER) throw notFound(`Dovecot has no mailbox ${email} (is it disabled?)`);
    throw new HttpError(502, "doveadm_error", `Recalculating the quota of ${email} failed (doveadm exit code ${r.exitCode})`);
  }
}
