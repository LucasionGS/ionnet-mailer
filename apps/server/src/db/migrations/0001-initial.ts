import { DataTypes, type QueryInterface } from "sequelize";

export async function up(qi: QueryInterface): Promise<void> {
  const now = { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal("now()") };
  const uuid = { type: DataTypes.UUID, primaryKey: true, defaultValue: qi.sequelize.literal("gen_random_uuid()") };

  await qi.createTable("domains", {
    id: uuid,
    name: { type: DataTypes.STRING(253), allowNull: false, unique: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    dkim_selector: { type: DataTypes.STRING(63), allowNull: false, defaultValue: "mail" },
    dkim_private_key_pem: { type: DataTypes.TEXT, allowNull: false },
    dkim_public_key_b64: { type: DataTypes.TEXT, allowNull: false },
    created_at: now,
  });
  await qi.addIndex("domains", ["name"], { name: "domains_name_idx" });

  await qi.createTable("mailboxes", {
    id: uuid,
    domain_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "domains", key: "id" },
      onDelete: "CASCADE",
    },
    local_part: { type: DataTypes.STRING(64), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    display_name: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    signature: { type: DataTypes.TEXT, allowNull: true },
    quota_bytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    is_admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: now,
  });
  await qi.addIndex("mailboxes", ["email"], { name: "mailboxes_email_idx" });
  await qi.addIndex("mailboxes", ["domain_id"], { name: "mailboxes_domain_idx" });

  await qi.createTable("aliases", {
    id: uuid,
    domain_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "domains", key: "id" },
      onDelete: "CASCADE",
    },
    source: { type: DataTypes.STRING(254), allowNull: false },
    destination: { type: DataTypes.STRING(254), allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: now,
  });
  await qi.addIndex("aliases", ["source"], { name: "aliases_source_idx" });
  await qi.addIndex("aliases", ["source", "destination"], { name: "aliases_source_destination_uq", unique: true });

  await qi.createTable("app_settings", {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false },
  });

  await qi.createTable("sessions", {
    id: { type: DataTypes.STRING(128), primaryKey: true },
    mailbox_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "mailboxes", key: "id" },
      onDelete: "CASCADE",
    },
    created_at: now,
    expires_at: { type: DataTypes.DATE, allowNull: false },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    user_agent: { type: DataTypes.STRING(512), allowNull: true },
  });
  await qi.addIndex("sessions", ["mailbox_id"], { name: "sessions_mailbox_idx" });

  await qi.createTable("contacts", {
    id: uuid,
    mailbox_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "mailboxes", key: "id" },
      onDelete: "CASCADE",
    },
    name: { type: DataTypes.STRING(200), allowNull: false },
    emails: { type: DataTypes.ARRAY(DataTypes.STRING(254)), allowNull: false, defaultValue: [] },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    source: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "manual" },
    created_at: now,
    updated_at: now,
  });
  await qi.addIndex("contacts", ["mailbox_id"], { name: "contacts_mailbox_idx" });

  await qi.createTable("recent_addresses", {
    mailbox_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: { model: "mailboxes", key: "id" },
      onDelete: "CASCADE",
    },
    address: { type: DataTypes.STRING(254), primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false, defaultValue: "" },
    last_used_at: now,
    uses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  });

  await qi.createTable("dns_checks", {
    domain_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: { model: "domains", key: "id" },
      onDelete: "CASCADE",
    },
    result: { type: DataTypes.JSONB, allowNull: false },
    checked_at: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down(qi: QueryInterface): Promise<void> {
  for (const t of ["dns_checks", "recent_addresses", "contacts", "sessions", "app_settings", "aliases", "mailboxes", "domains"]) {
    await qi.dropTable(t);
  }
}
