import { Op } from "sequelize";
import { AliasRow, type MailboxRow } from "../db/models.ts";

/** Addresses this user may put in From: their mailbox plus aliases that deliver to them. */
export async function allowedSenders(user: MailboxRow): Promise<string[]> {
  const aliases = await AliasRow.findAll({ where: { destination: user.email, active: true, source: { [Op.notLike]: "@%" } } });
  return [user.email, ...aliases.map((a) => a.source)];
}
