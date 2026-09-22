import type { MailboxRow } from "../db/models.ts";
import { logger } from "../logger.ts";
import { pool } from "./pool.ts";
import { quotaUsage } from "./doveadm.ts";

const log = logger("usage");

/** Storage used by a mailbox, via IMAP QUOTA (Dovecot quota plugin). */
async function imapUsage(m: MailboxRow): Promise<number | null> {
  return pool.withClient(m, async (client) => {
    const q = await client.getQuota("INBOX");
    if (!q || !q.storage) return null;
    return quotaBytes(q.storage);
  });
}

/**
 * Storage used per mailbox id. doveadm reports usage whether or not a limit is
 * set; IMAP QUOTA only reports it for mailboxes with a limit, so it is the fallback.
 */
export async function getMailboxUsages(mailboxes: MailboxRow[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  try {
    const usage = await quotaUsage(mailboxes.map((m) => m.email));
    for (const m of mailboxes) out.set(m.id, usage.get(m.email)?.usedBytes ?? null);
    return out;
  } catch (err) {
    log.warn(`doveadm quota lookup failed, falling back to IMAP: ${(err as Error).message}`);
  }
  await Promise.all(mailboxes.map(async (m) => out.set(m.id, await imapUsage(m).catch(() => null))));
  return out;
}

export async function getMailboxUsage(m: MailboxRow): Promise<number | null> {
  return (await getMailboxUsages([m])).get(m.id) ?? null;
}

/** imapflow reports storage quota in bytes under `usage` (older typings say `used`). */
export function quotaBytes(st: { usage?: number; used?: number }): number {
  return Number(st.usage ?? st.used ?? 0);
}
