import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Address, MailEvent } from "@ionnet/shared";
import type { MailboxRow } from "../db/models.ts";
import { openDedicated } from "./pool.ts";
import { logger } from "../logger.ts";

const log = logger("sse");

/** One dedicated IMAP connection per SSE subscriber, kept in IDLE on INBOX. */
export function mailEvents(c: Context, user: MailboxRow, clientIp: string): Response {
  return streamSSE(c, async (stream) => {
    let closed = false;
    const send = (event: MailEvent) => (closed ? Promise.resolve() : stream.writeSSE({ data: JSON.stringify(event), event: event.type }));
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
      let nextUid = box.uidNext;
      client.on("exists", async () => {
        try {
          const found: Array<{ uid: number; from: Address | null; subject: string }> = [];
          for await (const m of client.fetch({ uid: `${nextUid}:*` }, { uid: true, envelope: true }, { uid: true })) {
            if (m.uid < nextUid) continue;
            const f = m.envelope?.from?.[0];
            found.push({ uid: m.uid, from: f?.address ? { name: f.name ?? "", address: f.address } : null, subject: m.envelope?.subject ?? "" });
            nextUid = Math.max(nextUid, m.uid + 1);
          }
          for (const f of found) await send({ type: "new", folder: "INBOX", uid: f.uid, from: f.from, subject: f.subject });
          if (found.length) await send({ type: "folders" });
        } catch (err) {
          log.debug(`exists handler failed: ${(err as Error).message}`);
        }
      });
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
