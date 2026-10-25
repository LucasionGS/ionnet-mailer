import { Op } from "sequelize";
import { config } from "../config.ts";
import { AuditRow, AuthEventRow, IpBanRow, MailLogRow } from "../db/models.ts";
import { logger } from "../logger.ts";

const log = logger("retention");

/** Deletes activity older than ACTIVITY_RETENTION_DAYS; the audit log and ended IP bans are kept for at least a year. */
export async function purgeOldActivity(): Promise<void> {
  const day = 86_400_000;
  const cutoff = new Date(Date.now() - config.ACTIVITY_RETENTION_DAYS * day);
  const auditCutoff = new Date(Date.now() - Math.max(config.ACTIVITY_RETENTION_DAYS, 365) * day);
  const [auth, mail, audit] = await Promise.all([
    AuthEventRow.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
    MailLogRow.destroy({ where: { updatedAt: { [Op.lt]: cutoff } } }),
    AuditRow.destroy({ where: { createdAt: { [Op.lt]: auditCutoff } } }),
    // Ended bans still count towards a repeat offender's longer ban, so they go with the audit log.
    IpBanRow.destroy({ where: { [Op.or]: [{ liftedAt: { [Op.lt]: auditCutoff } }, { liftedAt: null, expiresAt: { [Op.lt]: auditCutoff } }] } }),
  ]);
  if (auth + mail + audit) log.info(`removed ${auth} sign-in, ${mail} mail log and ${audit} audit rows past retention`);
}
