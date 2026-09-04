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
