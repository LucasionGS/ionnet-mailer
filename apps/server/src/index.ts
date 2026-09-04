import { serve } from "@hono/node-server";
import { config } from "./config.ts";
import { logger } from "./logger.ts";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";
import { sequelize } from "./db/sequelize.ts";
import { materializeAllKeys } from "./admin/dkim.ts";
import { initSetupToken, stopSetupBanner } from "./setup/token.ts";
import { seedDevData } from "./seed.ts";
import { pool } from "./mail/pool.ts";
import { closeRedis, redis } from "./redis.ts";
import { purgeExpiredSessions } from "./auth/session.ts";

const log = logger("boot");

async function main() {
  await sequelize.authenticate();
  await runMigrations();
  await redis().connect().catch((err) => log.warn(`redis not reachable yet: ${(err as Error).message}`));
  if (config.DEV_SEED && config.isDev) await seedDevData();
  await materializeAllKeys();
  await initSetupToken();

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
    log.info(`Ionnet Mailer API listening on http://${info.address}:${info.port} (${config.NODE_ENV}, hostname ${config.MAIL_HOSTNAME})`);
  });

  const housekeeping = setInterval(() => void purgeExpiredSessions().catch(() => undefined), 6 * 3600_000);
  housekeeping.unref();

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down`);
    stopSetupBanner();
    server.close();
    await pool.closeAll();
    await closeRedis();
    await sequelize.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal during startup", err);
  process.exit(1);
});
