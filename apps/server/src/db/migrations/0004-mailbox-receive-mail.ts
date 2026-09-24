import { DataTypes, type QueryInterface } from "sequelize";

// Send-only mailboxes (noreply@ and the like): Postfix rejects mail addressed to them.
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("mailboxes", "receive_mail", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("mailboxes", "receive_mail");
}
