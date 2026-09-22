import { Op, QueryTypes, type WhereOptions } from "sequelize";
import type { AuthEvent, AuthFailureReason, AuthSource, FailedIp, Page } from "@ionnet/shared";
import { AuthEventRow, MailboxRow } from "../db/models.ts";
import { sequelize } from "../db/sequelize.ts";
import { logger } from "../logger.ts";
import { likePattern, pageOf } from "./paging.ts";

const log = logger("auth-events");

// Repeats of the same attempt inside this window add to one row's count instead of adding rows,
// so a phone reconnecting all day or a password-guessing bot doesn't flood the table.
const FOLD_MS = { success: 60 * 60_000, failure: 10 * 60_000 };

export interface AuthAttempt {
  source: AuthSource;
  username: string | null;
  ip: string | null;
  success: boolean;
  reason?: AuthFailureReason | null;
  detail?: string | null;
  userAgent?: string | null;
  mailboxId?: string | null;
}

/** Never throws: a sign-in must not fail because its audit trail could not be written. */
export async function recordAuthEvent(a: AuthAttempt): Promise<void> {
  try {
    const username = a.username?.trim().toLowerCase().slice(0, 254) || null;
    const ip = a.ip && a.ip !== "unknown" ? a.ip.slice(0, 64) : null;
    const reason = a.success ? null : (a.reason ?? null);
    const since = new Date(Date.now() - (a.success ? FOLD_MS.success : FOLD_MS.failure));
    const existing = await AuthEventRow.findOne({
      where: { source: a.source, username, ip, success: a.success, reason, createdAt: { [Op.gt]: since } },
      order: [["id", "DESC"]],
      attributes: ["id"],
    });
    if (existing) {
      await sequelize.query("UPDATE auth_events SET count = count + 1, last_at = now() WHERE id = :id", {
        replacements: { id: existing.id },
        type: QueryTypes.UPDATE,
      });
      return;
    }
    let mailboxId = a.mailboxId ?? null;
    if (mailboxId === null && username) {
      mailboxId = (await MailboxRow.findOne({ where: { email: username }, attributes: ["id"] }))?.id ?? null;
    }
    await AuthEventRow.create({
      source: a.source,
      username,
      mailboxId,
      ip,
      success: a.success,
      reason,
      detail: a.detail?.slice(0, 255) || null,
      userAgent: a.userAgent?.slice(0, 512) || null,
    });
  } catch (err) {
    log.warn(`could not record sign-in attempt: ${(err as Error).message}`);
  }
}

/** Why a password check failed, judged from the account it named. */
export async function failureReason(username: string | null): Promise<{ reason: AuthFailureReason; mailboxId: string | null }> {
  const m = username ? await MailboxRow.findOne({ where: { email: username.trim().toLowerCase() }, attributes: ["id", "active"] }) : null;
  if (!m) return { reason: "unknown_user", mailboxId: null };
  return { reason: m.active ? "wrong_password" : "disabled", mailboxId: m.id };
}

export function toAuthEventDto(r: AuthEventRow): AuthEvent {
  return {
    id: String(r.id),
    source: r.source as AuthSource,
    username: r.username,
    mailboxId: r.mailboxId,
    ip: r.ip,
    success: r.success,
    reason: (r.reason as AuthFailureReason | null) ?? null,
    detail: r.detail,
    userAgent: r.userAgent,
    count: r.count,
    firstAt: r.createdAt.toISOString(),
    lastAt: r.lastAt.toISOString(),
  };
}

export interface AuthEventFilter {
  result?: "success" | "failed";
  source?: AuthSource;
  q?: string;
  before?: string;
  limit: number;
}

export async function listAuthEvents(f: AuthEventFilter): Promise<Page<AuthEvent>> {
  const where: WhereOptions<AuthEventRow>[] = [];
  if (f.result) where.push({ success: f.result === "success" });
  if (f.source) where.push({ source: f.source });
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    where.push({ [Op.or]: [{ username: { [Op.iLike]: likePattern(q) } }, { ip: { [Op.startsWith]: q } }] });
  }
  if (f.before) where.push({ id: { [Op.lt]: f.before } });
  const rows = await AuthEventRow.findAll({ where: { [Op.and]: where }, order: [["id", "DESC"]], limit: f.limit + 1 });
  return pageOf(rows, f.limit, toAuthEventDto);
}

/** IPs with the most failed sign-ins in the last `hours`. */
export async function failedIps(hours: number, limit = 10): Promise<FailedIp[]> {
  const rows = await sequelize.query<{ ip: string; failures: number; last_at: Date; usernames: string[] | null; sources: string[] }>(
    `SELECT ip,
            sum(count)::int AS failures,
            max(last_at) AS last_at,
            (array_agg(DISTINCT username) FILTER (WHERE username IS NOT NULL))[1:5] AS usernames,
            array_agg(DISTINCT source) AS sources
       FROM auth_events
      WHERE NOT success AND ip IS NOT NULL AND created_at > now() - make_interval(hours => :hours)
      GROUP BY ip
      ORDER BY failures DESC, last_at DESC
      LIMIT :limit`,
    { replacements: { hours, limit }, type: QueryTypes.SELECT },
  );
  return rows.map((r) => ({
    ip: r.ip,
    failures: r.failures,
    usernames: r.usernames ?? [],
    sources: r.sources as AuthSource[],
    lastAt: new Date(r.last_at).toISOString(),
  }));
}
