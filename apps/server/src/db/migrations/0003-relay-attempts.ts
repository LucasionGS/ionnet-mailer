import type { QueryInterface } from "sequelize";

// Port-25 rejects used to be filed by recipient alone, so open-relay probes showed up as outgoing mail.
export async function up(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`UPDATE mail_log SET direction = 'relay' WHERE status = 'rejected' AND source = 'smtp' AND direction = 'out' AND recipient <> ''`);
  await qi.sequelize.query(`UPDATE mail_log SET direction = 'in' WHERE status = 'rejected' AND source = 'smtp' AND direction = 'out'`);
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`UPDATE mail_log SET direction = 'out' WHERE direction = 'relay'`);
}
