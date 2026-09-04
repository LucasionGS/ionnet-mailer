import { createHash, randomBytes } from "node:crypto";
import { MailboxRow, getSetting, setSetting } from "../db/models.ts";
import { config } from "../config.ts";
import { logger } from "../logger.ts";

const log = logger("setup");
let plainToken: string | null = null;
let banner: NodeJS.Timeout | null = null;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function isSetupCompleted(): Promise<boolean> {
  return (await getSetting("setup_completed")) === "1";
}

export async function markSetupCompleted(): Promise<void> {
  await setSetting("setup_completed", "1");
  plainToken = null;
  if (banner) clearInterval(banner);
  banner = null;
}

/** Called at boot. Generates a fresh one-time token when the instance has no mailbox yet. */
export async function initSetupToken(): Promise<void> {
  if (await isSetupCompleted()) return;
  if ((await MailboxRow.count()) > 0) {
    // Accounts exist (e.g. seeded) but the flag is missing: treat as completed.
    await markSetupCompleted();
    return;
  }
  plainToken = randomBytes(24).toString("base64url");
  await setSetting("setup_token_hash", sha(plainToken));
  const print = () => {
    if (!plainToken) return;
    const url = `${config.publicUrl}/setup?token=${plainToken}`;
    const width = Math.max(66, url.length + 4);
    const row = (text: string) => `  │ ${text.padEnd(width - 2)} │`;
    const lines = [
      "",
      `  ┌${"─".repeat(width)}┐`,
      row("Ionnet Mailer is not set up yet."),
      row("Open the setup wizard and enter this one-time token:"),
      row(""),
      row(`  ${plainToken}`),
      row(""),
      row(url),
      `  └${"─".repeat(width)}┘`,
      "",
    ];
    console.log(lines.join("\n"));
  };
  print();
  banner = setInterval(print, 60_000);
  banner.unref();
}

export async function verifySetupToken(token: string): Promise<boolean> {
  const hash = await getSetting("setup_token_hash");
  return !!hash && !!token && sha(token) === hash;
}

export function stopSetupBanner() {
  if (banner) clearInterval(banner);
}
