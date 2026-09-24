import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { PasswordSchema } from "@ionnet/shared";
import { AuditRow, MailboxRow, Session } from "./db/models.ts";
import { sequelize } from "./db/sequelize.ts";
import { hashPassword } from "./auth/password.ts";
import { clearFailures, listLockouts, removeLockout } from "./auth/ratelimit.ts";
import { closeRedis } from "./redis.ts";

/**
 * Recovery commands for when nobody can get into the admin area, run inside the app container:
 *   docker compose exec app node dist/cli.js <command>
 */
const USAGE = `usage: cli <command>

  users                          list mailboxes, with admin and active flags
  passwd <email> [--generate]    set a new password (prompted, or read from stdin);
                                 also clears the account's lockout and signs it out everywhere
  logout <email> | --all         sign out every web session of one mailbox, or of everyone
  unlock [<email|ip>]            clear sign-in lockouts; with no argument, list them
`;

class UsageError extends Error {}

/** The CLI has no signed-in user, so its changes show up in the audit log as "system". */
async function audit(action: string, target: string | null, detail?: Record<string, unknown>) {
  await AuditRow.create({ actorId: null, actorEmail: null, ip: null, action, target, detail: { ...detail, via: "cli" } });
}

async function requireMailbox(email: string | undefined): Promise<MailboxRow> {
  if (!email) throw new UsageError("missing <email>");
  const m = await MailboxRow.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!m) throw new Error(`no mailbox ${email}`);
  return m;
}

/** Reads a line from the terminal without echoing it, or a plain line when stdin is piped. */
async function readSecret(label: string): Promise<string> {
  const prompt = process.stdin.isTTY ? label : "";
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    // Print the prompt, then swallow everything readline would echo back.
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    out._writeToOutput = (s) => {
      if (s.includes(prompt)) process.stdout.write(prompt);
    };
  }
  // Without a listener, Ctrl+C would only pause the prompt.
  rl.on("SIGINT", () => rl.close());
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.question(prompt, resolve);
      rl.once("close", () => reject(new Error("no password given")));
    });
  } finally {
    rl.close();
    if (process.stdin.isTTY) process.stdout.write("\n");
  }
}

async function choosePassword(generate: boolean): Promise<string> {
  if (generate) return randomBytes(15).toString("base64url");
  const password = await readSecret("New password: ");
  const check = PasswordSchema.safeParse(password);
  if (!check.success) throw new Error(check.error.issues[0]?.message ?? "invalid password");
  if (process.stdin.isTTY && (await readSecret("Repeat password: ")) !== password) throw new Error("passwords do not match");
  return password;
}

async function signOut(where: { mailboxId?: string }): Promise<number> {
  return Session.destroy({ where });
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async users() {
    const rows = await MailboxRow.findAll({ order: [["email", "ASC"]] });
    for (const m of rows) {
      const flags = [m.isAdmin && "admin", !m.active && "disabled"].filter(Boolean).join(", ");
      console.log(flags ? `${m.email}  (${flags})` : m.email);
    }
  },

  async passwd(args) {
    const m = await requireMailbox(args.find((a) => !a.startsWith("--")));
    const generate = args.includes("--generate");
    const password = await choosePassword(generate);
    m.passwordHash = await hashPassword(password);
    await m.save();
    await clearFailures("user", m.email);
    const sessions = await signOut({ mailboxId: m.id });
    await audit("mailbox.update", m.email, { password: "changed" });
    console.log(`password changed for ${m.email}; signed out ${sessions} web session(s)`);
    if (generate) console.log(`new password: ${password}`);
    if (!m.active) console.log("note: this mailbox is disabled, so it still cannot sign in");
  },

  async logout([target]) {
    if (target === "--all") {
      const n = await signOut({});
      await audit("session.revoke", null, { all: true, sessions: n });
      console.log(`signed out ${n} web session(s)`);
      return;
    }
    const m = await requireMailbox(target);
    const n = await signOut({ mailboxId: m.id });
    await audit("session.revoke", m.email, { sessions: n });
    console.log(`signed out ${n} web session(s) of ${m.email}`);
  },

  async unlock([target]) {
    if (!target) {
      const locks = await listLockouts();
      if (!locks.length) console.log("no lockouts");
      for (const l of locks) console.log(`${l.key}  ${l.attempts} attempts, until ${l.lockedUntil ?? "?"}`);
      return;
    }
    const key = target.includes("@") ? `user:${target.trim().toLowerCase()}` : `ip:${target.trim()}`;
    await removeLockout(key);
    await audit("lockout.remove", key);
    console.log(`cleared ${key}`);
  },
};

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  process.stderr.write(USAGE);
  process.exit(name && name !== "help" && name !== "--help" ? 2 : 0);
}
try {
  await command(args);
} catch (err) {
  console.error(`error: ${(err as Error).message}`);
  if (err instanceof UsageError) process.stderr.write(USAGE);
  process.exitCode = 1;
} finally {
  await closeRedis();
  await sequelize.close();
}
