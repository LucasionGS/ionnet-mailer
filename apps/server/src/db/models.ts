import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "./sequelize.ts";

export class Domain extends Model<InferAttributes<Domain>, InferCreationAttributes<Domain>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare active: CreationOptional<boolean>;
  declare dkimSelector: CreationOptional<string>;
  declare dkimPrivateKeyPem: string;
  declare dkimPublicKeyB64: string;
  declare createdAt: CreationOptional<Date>;
}
Domain.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(253), allowNull: false, unique: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    dkimSelector: { type: DataTypes.STRING(63), allowNull: false, defaultValue: "mail" },
    dkimPrivateKeyPem: { type: DataTypes.TEXT, allowNull: false },
    dkimPublicKeyB64: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "domains" },
);

export class MailboxRow extends Model<InferAttributes<MailboxRow>, InferCreationAttributes<MailboxRow>> {
  declare id: CreationOptional<string>;
  declare domainId: string;
  declare localPart: string;
  declare email: string;
  declare passwordHash: string;
  declare displayName: string;
  declare signature: CreationOptional<string | null>;
  declare quotaBytes: CreationOptional<number>;
  declare isAdmin: CreationOptional<boolean>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
}
MailboxRow.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    domainId: { type: DataTypes.UUID, allowNull: false },
    localPart: { type: DataTypes.STRING(64), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    displayName: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    signature: { type: DataTypes.TEXT, allowNull: true },
    quotaBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      get() {
        return Number(this.getDataValue("quotaBytes"));
      },
    },
    isAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "mailboxes" },
);

export class AliasRow extends Model<InferAttributes<AliasRow>, InferCreationAttributes<AliasRow>> {
  declare id: CreationOptional<string>;
  declare domainId: string;
  declare source: string;
  declare destination: string;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
}
AliasRow.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    domainId: { type: DataTypes.UUID, allowNull: false },
    source: { type: DataTypes.STRING(254), allowNull: false },
    destination: { type: DataTypes.STRING(254), allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "aliases" },
);

export class AppSetting extends Model<InferAttributes<AppSetting>, InferCreationAttributes<AppSetting>> {
  declare key: string;
  declare value: string;
}
AppSetting.init(
  {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, tableName: "app_settings" },
);

export class Session extends Model<InferAttributes<Session>, InferCreationAttributes<Session>> {
  declare id: string;
  declare mailboxId: string;
  declare createdAt: CreationOptional<Date>;
  declare expiresAt: Date;
  declare ip: string | null;
  declare userAgent: string | null;
}
Session.init(
  {
    id: { type: DataTypes.STRING(128), primaryKey: true },
    mailboxId: { type: DataTypes.UUID, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.STRING(512), allowNull: true },
  },
  { sequelize, tableName: "sessions" },
);

export class ContactRow extends Model<InferAttributes<ContactRow>, InferCreationAttributes<ContactRow>> {
  declare id: CreationOptional<string>;
  declare mailboxId: string;
  declare name: string;
  declare emails: string[];
  declare notes: CreationOptional<string>;
  declare source: CreationOptional<"manual" | "auto">;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ContactRow.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    mailboxId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(200), allowNull: false },
    emails: { type: DataTypes.ARRAY(DataTypes.STRING(254)), allowNull: false, defaultValue: [] },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    source: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "manual" },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "contacts" },
);

export class RecentAddress extends Model<InferAttributes<RecentAddress>, InferCreationAttributes<RecentAddress>> {
  declare mailboxId: string;
  declare address: string;
  declare name: string;
  declare lastUsedAt: Date;
  declare uses: number;
}
RecentAddress.init(
  {
    mailboxId: { type: DataTypes.UUID, primaryKey: true },
    address: { type: DataTypes.STRING(254), primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false, defaultValue: "" },
    lastUsedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    uses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  },
  { sequelize, tableName: "recent_addresses" },
);

export class DnsCheckRow extends Model<InferAttributes<DnsCheckRow>, InferCreationAttributes<DnsCheckRow>> {
  declare domainId: string;
  declare result: unknown;
  declare checkedAt: Date;
}
DnsCheckRow.init(
  {
    domainId: { type: DataTypes.UUID, primaryKey: true },
    result: { type: DataTypes.JSONB, allowNull: false },
    checkedAt: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "dns_checks" },
);

// BIGSERIAL ids come back from pg as strings; they are only ever used as opaque cursors.
export class AuthEventRow extends Model<InferAttributes<AuthEventRow>, InferCreationAttributes<AuthEventRow>> {
  declare id: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare lastAt: CreationOptional<Date>;
  declare source: string;
  declare username: string | null;
  declare mailboxId: string | null;
  declare ip: string | null;
  declare success: boolean;
  declare reason: string | null;
  declare detail: string | null;
  declare userAgent: string | null;
  declare count: CreationOptional<number>;
}
AuthEventRow.init(
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    lastAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    source: { type: DataTypes.STRING(16), allowNull: false },
    username: { type: DataTypes.STRING(254), allowNull: true },
    mailboxId: { type: DataTypes.UUID, allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    success: { type: DataTypes.BOOLEAN, allowNull: false },
    reason: { type: DataTypes.STRING(32), allowNull: true },
    detail: { type: DataTypes.STRING(255), allowNull: true },
    userAgent: { type: DataTypes.STRING(512), allowNull: true },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  },
  { sequelize, tableName: "auth_events" },
);

export class MailLogRow extends Model<InferAttributes<MailLogRow>, InferCreationAttributes<MailLogRow>> {
  declare id: CreationOptional<string>;
  declare queueId: string | null;
  declare messageId: string | null;
  declare direction: string;
  declare status: string;
  declare sender: string;
  declare recipient: string;
  declare origRecipient: string | null;
  declare subject: string | null;
  declare size: number | null;
  declare clientHost: string | null;
  declare clientIp: string | null;
  declare source: string | null;
  declare saslUser: string | null;
  declare relay: string | null;
  declare dsn: string | null;
  declare detail: string | null;
  declare attempts: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
MailLogRow.init(
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    queueId: { type: DataTypes.STRING(32), allowNull: true },
    messageId: { type: DataTypes.STRING(512), allowNull: true },
    direction: { type: DataTypes.STRING(8), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false },
    sender: { type: DataTypes.STRING(254), allowNull: false, defaultValue: "" },
    recipient: { type: DataTypes.STRING(254), allowNull: false },
    origRecipient: { type: DataTypes.STRING(254), allowNull: true },
    subject: { type: DataTypes.STRING(500), allowNull: true },
    size: { type: DataTypes.INTEGER, allowNull: true },
    clientHost: { type: DataTypes.STRING(255), allowNull: true },
    clientIp: { type: DataTypes.STRING(64), allowNull: true },
    source: { type: DataTypes.STRING(16), allowNull: true },
    saslUser: { type: DataTypes.STRING(254), allowNull: true },
    relay: { type: DataTypes.STRING(255), allowNull: true },
    dsn: { type: DataTypes.STRING(16), allowNull: true },
    detail: { type: DataTypes.TEXT, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "mail_log" },
);

export class AuditRow extends Model<InferAttributes<AuditRow>, InferCreationAttributes<AuditRow>> {
  declare id: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare actorId: string | null;
  declare actorEmail: string | null;
  declare ip: string | null;
  declare action: string;
  declare target: string | null;
  declare detail: Record<string, unknown> | null;
}
AuditRow.init(
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actorId: { type: DataTypes.UUID, allowNull: true },
    actorEmail: { type: DataTypes.STRING(254), allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    target: { type: DataTypes.STRING(254), allowNull: true },
    detail: { type: DataTypes.JSONB, allowNull: true },
  },
  { sequelize, tableName: "audit_log" },
);

Domain.hasMany(MailboxRow, { foreignKey: "domainId", as: "mailboxes" });
MailboxRow.belongsTo(Domain, { foreignKey: "domainId", as: "domain" });
Domain.hasMany(AliasRow, { foreignKey: "domainId", as: "aliases" });
AliasRow.belongsTo(Domain, { foreignKey: "domainId", as: "domain" });
Session.belongsTo(MailboxRow, { foreignKey: "mailboxId", as: "mailbox" });

export async function getSetting(key: string): Promise<string | null> {
  const row = await AppSetting.findByPk(key);
  return row?.value ?? null;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await AppSetting.upsert({ key, value });
}
