import type { Context } from "hono";
import { Op, type WhereOptions } from "sequelize";
import type { AuditEntry, Page } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { AuditRow } from "../db/models.ts";
import { logger } from "../logger.ts";
import { likePattern, pageOf } from "./paging.ts";

const log = logger("audit");

/**
 * Records a change made by the signed-in user. Never throws: the change itself
 * has already happened, and a missing audit row must not turn it into an error.
 */
export async function audit(c: Context<AppEnv>, action: string, target: string | null, detail?: Record<string, unknown>): Promise<void> {
  const user = c.get("user");
  try {
    await AuditRow.create({
      actorId: user?.id ?? null,
      actorEmail: user?.email ?? null,
      ip: c.get("clientIp") ?? null,
      action,
      target: target?.slice(0, 254) ?? null,
      detail: detail && Object.keys(detail).length ? detail : null,
    });
  } catch (err) {
    log.warn(`could not record ${action}: ${(err as Error).message}`);
  }
}

export function toAuditDto(r: AuditRow): AuditEntry {
  return {
    id: String(r.id),
    createdAt: r.createdAt.toISOString(),
    actorEmail: r.actorEmail,
    ip: r.ip,
    action: r.action,
    target: r.target,
    detail: r.detail,
  };
}

export async function listAudit(f: { q?: string; before?: string; limit: number }): Promise<Page<AuditEntry>> {
  const where: WhereOptions<AuditRow>[] = [];
  if (f.q) {
    const p = likePattern(f.q.trim());
    where.push({ [Op.or]: [{ action: { [Op.iLike]: p } }, { target: { [Op.iLike]: p } }, { actorEmail: { [Op.iLike]: p } }] });
  }
  if (f.before) where.push({ id: { [Op.lt]: f.before } });
  const rows = await AuditRow.findAll({ where: { [Op.and]: where }, order: [["id", "DESC"]], limit: f.limit + 1 });
  return pageOf(rows, f.limit, toAuditDto);
}
