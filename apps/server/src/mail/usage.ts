import type { MailboxRow } from "../db/models.ts";
import { pool } from "./pool.ts";

/** Storage used by a mailbox, via IMAP QUOTA (Dovecot quota plugin). */
export async function getMailboxUsage(m: MailboxRow): Promise<number | null> {
  return pool.withClient(m, async (client) => {
    const q = await client.getQuota("INBOX");
    if (!q || !q.storage) return null;
    return quotaBytes(q.storage);
  });
}

/** imapflow reports storage quota in bytes under `usage` (older typings say `used`). */
export function quotaBytes(st: { usage?: number; used?: number }): number {
  return Number(st.usage ?? st.used ?? 0);
}
