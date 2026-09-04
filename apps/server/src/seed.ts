import { pathToFileURL } from "node:url";
import { Domain } from "./db/models.ts";
import { sequelize } from "./db/sequelize.ts";
import { afterDomainCommit, createAlias, createDomain, createMailbox } from "./admin/service.ts";
import { markSetupCompleted } from "./setup/token.ts";
import { logger } from "./logger.ts";

const log = logger("seed");
const PASSWORD = "password1234";

/** Development convenience: a ready-to-use domain with two mailboxes. */
export async function seedDevData(): Promise<void> {
  if ((await Domain.count()) > 0) return;
  const domain = await createDomain("example.test");
  await afterDomainCommit(domain);
  await createMailbox(domain, { localPart: "admin", displayName: "Admin", password: PASSWORD, quotaBytes: 0, isAdmin: true });
  await createMailbox(domain, { localPart: "alice", displayName: "Alice Example", password: PASSWORD, quotaBytes: 1024 * 1024 * 1024, isAdmin: false });
  await createAlias(domain, "hello", "admin@example.test");
  await markSetupCompleted();
  log.info(`seeded example.test — log in as admin@example.test or alice@example.test with password "${PASSWORD}"`);
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  const { runMigrations } = await import("./db/migrate.ts");
  await runMigrations();
  await seedDevData();
  await sequelize.close();
}
