import { DataTypes, type QueryInterface } from "sequelize";

// Addresses banned for password guessing. Postfix and Dovecot ask ip_is_banned() on every connection or sign-in,
// so a ban applies to SMTP, IMAP, POP3 and ManageSieve as well as the web app.
export async function up(qi: QueryInterface): Promise<void> {
  const now = { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal("now()") };
  await qi.createTable("ip_bans", {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    network: { type: DataTypes.CIDR, allowNull: false },
    reason: { type: DataTypes.STRING(255), allowNull: true },
    source: { type: DataTypes.STRING(16), allowNull: false },
    created_by: { type: DataTypes.STRING(254), allowNull: true },
    created_at: now,
    expires_at: { type: DataTypes.DATE, allowNull: true },
    lifted_at: { type: DataTypes.DATE, allowNull: true },
    lifted_by: { type: DataTypes.STRING(254), allowNull: true },
    hits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_hit_at: { type: DataTypes.DATE, allowNull: true },
  });
  await qi.addIndex("ip_bans", ["created_at"], { name: "ip_bans_created_idx" });
  await qi.sequelize.query("CREATE INDEX ip_bans_network_idx ON ip_bans USING gist (network inet_ops)");
  // Postfix also looks up hostnames and partial addresses ("1.2.3") with the same query, so anything that is not an
  // address is simply "not banned". plpgsql keeps the cast from being folded before the validity check runs.
  await qi.sequelize.query(`
    CREATE OR REPLACE FUNCTION ip_is_banned(addr text) RETURNS boolean
    LANGUAGE plpgsql STABLE AS $$
    DECLARE a text := regexp_replace(coalesce(addr, ''), '^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$', '\\1', 'i');
    BEGIN
      IF a = '' OR NOT pg_input_is_valid(a, 'inet') THEN RETURN false; END IF;
      RETURN EXISTS (
        SELECT 1 FROM ip_bans
         WHERE network >>= a::inet AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())
      );
    END $$`);
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query("DROP FUNCTION IF EXISTS ip_is_banned(text)");
  await qi.dropTable("ip_bans");
}
