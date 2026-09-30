import { DataTypes, type QueryInterface } from "sequelize";

// Senders (addresses or domains) whose remote images the web client loads without asking.
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("mailboxes", "remote_content_allow", { type: DataTypes.ARRAY(DataTypes.STRING(254)), allowNull: false, defaultValue: [] });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("mailboxes", "remote_content_allow");
}
