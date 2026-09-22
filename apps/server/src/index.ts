import path from "node:path";
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
import { internalApp } from "./activity/dovecot-events.ts";
import { LogTailer } from "./activity/log-tail.ts";
import { ingestPostfixLine, pruneContexts } from "./activity/mail-log.ts";
import { purgeOldActivity } from "./activity/retention.ts";

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

  // Dovecot's event exporter posts sign-in results here; the port is never published.
  const internal = serve({ fetch: internalApp.fetch, port: config.INTERNAL_PORT, hostname: "0.0.0.0" });

  // Postfix writes its log to the shared mail-logs volume; turn it into the admin mail log.
  const postfixTail = new LogTailer(path.join(config.LOGS_DIR, "postfix.log"), "tail:postfix", ingestPostfixLine);
  postfixTail.start();

  const housekeep = () => {
    void purgeExpiredSessions().catch(() => undefined);
    void purgeOldActivity().catch((err) => log.warn(`retention cleanup failed: ${(err as Error).message}`));
    pruneContexts();
  };
  const housekeeping = setInterval(housekeep, 6 * 3600_000);
  housekeeping.unref();
  setTimeout(housekeep, 60_000).unref();

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down`);
    stopSetupBanner();
    server.close();
    internal.close();
    await postfixTail.stop();
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
