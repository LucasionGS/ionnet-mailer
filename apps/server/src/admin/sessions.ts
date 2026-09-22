import { createHash } from "node:crypto";
import { Op } from "sequelize";
import type { WebSession } from "@ionnet/shared";
import { MailboxRow, Session } from "../db/models.ts";
import { notFound } from "../errors.ts";

/** Session ids are the cookie secret, so the admin UI only ever sees a hash of them. */
function handle(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("base64url").slice(0, 22);
}

export async function listWebSessions(currentSessionId: string): Promise<WebSession[]> {
  const rows = await Session.findAll({
    where: { expiresAt: { [Op.gt]: new Date() } },
    include: [{ model: MailboxRow, as: "mailbox", attributes: ["email"] }],
    order: [["createdAt", "DESC"]],
  });
  return rows.map((s) => {
    const mailbox = (s as Session & { mailbox?: MailboxRow }).mailbox;
    return {
      id: handle(s.id),
      mailboxId: s.mailboxId,
      email: mailbox?.email ?? "",
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    };
  });
}

/** Returns the email of the session's owner, for the audit log. */
export async function revokeWebSession(handleId: string): Promise<string> {
  const rows = await Session.findAll({ attributes: ["id", "mailboxId"] });
  const match = rows.find((s) => handle(s.id) === handleId);
  if (!match) throw notFound("Session not found");
  await Session.destroy({ where: { id: match.id } });
  return (await MailboxRow.findByPk(match.mailboxId, { attributes: ["email"] }))?.email ?? match.mailboxId;
}
