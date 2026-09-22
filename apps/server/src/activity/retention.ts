import { Op } from "sequelize";
import { config } from "../config.ts";
import { AuditRow, AuthEventRow, MailLogRow } from "../db/models.ts";
import { logger } from "../logger.ts";

const log = logger("retention");

/** Deletes activity older than ACTIVITY_RETENTION_DAYS; the audit log is kept for at least a year. */
export async function purgeOldActivity(): Promise<void> {
  const day = 86_400_000;
  const cutoff = new Date(Date.now() - config.ACTIVITY_RETENTION_DAYS * day);
  const auditCutoff = new Date(Date.now() - Math.max(config.ACTIVITY_RETENTION_DAYS, 365) * day);
  const [auth, mail, audit] = await Promise.all([
    AuthEventRow.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
    MailLogRow.destroy({ where: { updatedAt: { [Op.lt]: cutoff } } }),
    AuditRow.destroy({ where: { createdAt: { [Op.lt]: auditCutoff } } }),
  ]);
  if (auth + mail + audit) log.info(`removed ${auth} sign-in, ${mail} mail log and ${audit} audit rows past retention`);
}
