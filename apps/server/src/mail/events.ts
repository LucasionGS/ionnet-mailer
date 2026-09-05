import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Address, MailEvent } from "@ionnet/shared";
import type { MailboxRow } from "../db/models.ts";
import { openDedicated } from "./pool.ts";
import { logger } from "../logger.ts";

const log = logger("sse");

/** One dedicated IMAP connection per SSE subscriber, kept in IDLE on INBOX. */
export function mailEvents(c: Context, user: MailboxRow, clientIp: string): Response {
  // Reverse proxies that buffer responses would hold every event back until the
  // stream ends, which for an SSE stream is never.
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let closed = false;
    // Writes are queued so the ping timer and the IMAP handlers cannot interleave,
    // and so a write that loses the race with a disconnect stays swallowed.
    let writes: Promise<void> = Promise.resolve();
    const send = (event: MailEvent): Promise<void> => {
      if (closed) return writes;
      writes = writes
        .then(() => (closed ? undefined : stream.writeSSE({ data: JSON.stringify(event), event: event.type })))
        .catch(() => undefined);
      return writes;
    };
    const client = await openDedicated(user, clientIp).catch((err) => {
      log.warn(`could not open IDLE connection for ${user.email}: ${(err as Error).message}`);
      return null;
    });
    if (!client) {
      await send({ type: "ping" });
      return;
    }
    const ping = setInterval(() => void send({ type: "ping" }), 25_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      client.logout().catch(() => client.close());
    };
    stream.onAbort(cleanup);
    try {
      const box = await client.mailboxOpen("INBOX");
      let nextUid = box.uidNext || 1;
      // ImapFlow runs one command at a time and `exists` can fire again while a
      // scan is still reading, so each scan queues behind the previous one.
      let scans: Promise<void> = Promise.resolve();
      const scan = () => {
        scans = scans
          .then(async () => {
            if (closed || !client.usable) return;
            const found: Array<{ uid: number; from: Address | null; subject: string }> = [];
            for await (const m of client.fetch({ uid: `${nextUid}:*` }, { uid: true, envelope: true }, { uid: true })) {
              if (m.uid < nextUid) continue;
              const f = m.envelope?.from?.[0];
              found.push({ uid: m.uid, from: f?.address ? { name: f.name ?? "", address: f.address } : null, subject: m.envelope?.subject ?? "" });
              nextUid = Math.max(nextUid, m.uid + 1);
            }
            for (const f of found) await send({ type: "new", folder: "INBOX", uid: f.uid, from: f.from, subject: f.subject });
            if (found.length) await send({ type: "folders" });
          })
          .catch((err: unknown) => {
            log.debug(`exists handler failed: ${(err as Error).message}`);
          });
      };
      client.on("exists", scan);
      client.on("expunge", (ev) => {
        if (ev.uid) void send({ type: "expunge", folder: "INBOX", uid: ev.uid });
        void send({ type: "folders" });
      });
      client.on("flags", (ev) => {
        if (ev.uid) void send({ type: "flags", folder: "INBOX", uid: ev.uid, flags: [...ev.flags] });
        void send({ type: "folders" });
      });
      client.on("close", () => {
        closed = true;
        clearInterval(ping);
      });
      await send({ type: "ping" });
      // Keep the handler alive until the client goes away; imapflow auto-IDLEs while we wait.
      while (!closed && client.usable) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      cleanup();
    }
  });
}
