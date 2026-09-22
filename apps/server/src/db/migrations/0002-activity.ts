import { DataTypes, type QueryInterface } from "sequelize";

export async function up(qi: QueryInterface): Promise<void> {
  const now = { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal("now()") };
  const id = { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true };
  const mailboxRef = {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "mailboxes", key: "id" },
    onDelete: "SET NULL",
  };

  // Sign-in attempts from the web app and from Dovecot (IMAP, POP3, SMTP AUTH, ManageSieve).
  await qi.createTable("auth_events", {
    id,
    created_at: now,
    last_at: now,
    source: { type: DataTypes.STRING(16), allowNull: false },
    username: { type: DataTypes.STRING(254), allowNull: true },
    mailbox_id: mailboxRef,
    ip: { type: DataTypes.STRING(64), allowNull: true },
    success: { type: DataTypes.BOOLEAN, allowNull: false },
    reason: { type: DataTypes.STRING(32), allowNull: true },
    detail: { type: DataTypes.STRING(255), allowNull: true },
    user_agent: { type: DataTypes.STRING(512), allowNull: true },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  });
  await qi.addIndex("auth_events", ["created_at"], { name: "auth_events_created_idx" });
  await qi.addIndex("auth_events", ["ip", "created_at"], { name: "auth_events_ip_idx" });
  await qi.addIndex("auth_events", ["username", "created_at"], { name: "auth_events_username_idx" });

  // What Postfix did with each recipient of each message, parsed from its log.
  await qi.createTable("mail_log", {
    id,
    queue_id: { type: DataTypes.STRING(32), allowNull: true },
    message_id: { type: DataTypes.STRING(512), allowNull: true },
    direction: { type: DataTypes.STRING(8), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false },
    sender: { type: DataTypes.STRING(254), allowNull: false, defaultValue: "" },
    recipient: { type: DataTypes.STRING(254), allowNull: false },
    orig_recipient: { type: DataTypes.STRING(254), allowNull: true },
    subject: { type: DataTypes.STRING(500), allowNull: true },
    size: { type: DataTypes.INTEGER, allowNull: true },
    client_host: { type: DataTypes.STRING(255), allowNull: true },
    client_ip: { type: DataTypes.STRING(64), allowNull: true },
    source: { type: DataTypes.STRING(16), allowNull: true },
    sasl_user: { type: DataTypes.STRING(254), allowNull: true },
    relay: { type: DataTypes.STRING(255), allowNull: true },
    dsn: { type: DataTypes.STRING(16), allowNull: true },
    detail: { type: DataTypes.TEXT, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    created_at: now,
    updated_at: now,
  });
  await qi.addIndex("mail_log", ["created_at"], { name: "mail_log_created_idx" });
  // Rejected attempts have no queue id; NULLs never collide in a unique index.
  await qi.addIndex("mail_log", ["queue_id", "recipient"], { name: "mail_log_queue_rcpt_uq", unique: true });
  await qi.addIndex("mail_log", ["status", "created_at"], { name: "mail_log_status_idx" });

  // Changes made through the admin area, and password changes.
  await qi.createTable("audit_log", {
    id,
    created_at: now,
    actor_id: mailboxRef,
    actor_email: { type: DataTypes.STRING(254), allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    target: { type: DataTypes.STRING(254), allowNull: true },
    detail: { type: DataTypes.JSONB, allowNull: true },
  });
  await qi.addIndex("audit_log", ["created_at"], { name: "audit_log_created_idx" });
}

export async function down(qi: QueryInterface): Promise<void> {
  for (const t of ["audit_log", "mail_log", "auth_events"]) await qi.dropTable(t);
}
