import { pathToFileURL } from "node:url";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { Umzug, SequelizeStorage } from "umzug";
import { sequelize } from "./sequelize.ts";
import { logger } from "../logger.ts";

const log = logger("db");
const migrationsDir = path.join(import.meta.dirname, "migrations");

// Migration files are .ts in development (Node strips types natively) and .js after `tsc`.
export const umzug = new Umzug({
  migrations: {
    glob: ["*.{ts,js}", { cwd: migrationsDir, ignore: ["**/*.d.ts"] }],
    resolve: ({ name, path: filePath }) => {
      const stableName = name.replace(/\.(ts|js)$/, "");
      const load = () => import(pathToFileURL(filePath!).href);
      return {
        name: stableName,
        up: async ({ context }) => (await load()).up(context),
        down: async ({ context }) => (await load()).down(context),
      };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize, tableName: "schema_migrations" }),
  logger: { info: (m) => log.info(JSON.stringify(m)), warn: (m) => log.warn(JSON.stringify(m)), error: (m) => log.error(JSON.stringify(m)), debug: () => undefined },
});

export async function runMigrations(): Promise<void> {
  const executed = await umzug.up();
  if (executed.length) log.info(`applied ${executed.length} migration(s): ${executed.map((m) => m.name).join(", ")}`);
  // Postfix and Dovecot read these tables through the read-only "mailreader" role.
  try {
    await sequelize.query("GRANT SELECT ON domains, mailboxes, aliases TO mailreader");
  } catch (err) {
    log.warn(`could not grant SELECT to mailreader (role missing?): ${(err as Error).message}`);
  }
}

async function createMigration(name: string) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const file = path.join(migrationsDir, `${stamp}-${name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.ts`);
  await writeFile(
    file,
    `import { DataTypes, type QueryInterface } from "sequelize";\n\nexport async function up(qi: QueryInterface): Promise<void> {\n  // TODO\n}\n\nexport async function down(qi: QueryInterface): Promise<void> {\n  // TODO\n}\n`,
  );
  log.info(`created ${file}`);
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "create") {
      if (!arg) throw new Error("usage: migrate create <name>");
      await createMigration(arg);
    } else if (cmd === "down") {
      await umzug.down();
    } else {
      await runMigrations();
    }
  } finally {
    await sequelize.close();
  }
}
