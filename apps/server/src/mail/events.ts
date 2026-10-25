import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ImapFlow } from "imapflow";
import type { Address, MailEvent } from "@ionnet/shared";
import type { MailboxRow } from "../db/models.ts";
import { openDedicated } from "./pool.ts";
import { logger } from "../logger.ts";

const log = logger("sse");
/** IDLE only watches INBOX; other folders (sieve rules, Junk, other mail apps) are compared this often. */
const FOLDER_POLL_MS = 30_000;

type Snapshot = Map<string, string>;

/** Message count, unread count and next UID of every folder, to spot the ones that changed. */
async function folderSnapshot(client: ImapFlow): Promise<Snapshot> {
  const rows = await client.list({ statusQuery: { messages: true, unseen: true, uidNext: true } });
  const out: Snapshot = new Map();
  for (const r of rows) {
    if (r.flags.has("\\Noselect") || r.flags.has("\\NonExistent")) continue;
    out.set(r.path, `${r.status?.messages ?? ""}/${r.status?.unseen ?? ""}/${r.status?.uidNext ?? ""}`);
  }
  return out;
}

/**
 * One dedicated IMAP connection per SSE subscriber, kept in IDLE on INBOX, plus a slower poll of the other folders.
 * The connection is opened before the stream starts so a failure answers 503 and the client backs off, instead of an
 * empty stream that ends at once and is retried every second.
 */
export async function mailEvents(c: Context, user: MailboxRow, clientIp: string): Promise<Response> {
  let client: ImapFlow;
  try {
    client = await openDedicated(user, clientIp);
  } catch (err) {
    log.warn(`could not open IDLE connection for ${user.email}: ${(err as Error).message}`);
    return c.json({ error: "imap_unavailable", message: "Live updates are not available right now." }, 503);
  }
  // Reverse proxies that buffer responses would hold every event back until the
  // stream ends, which for an SSE stream is never.
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let closed = false;
    let ping: NodeJS.Timeout | undefined;
    let poll: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clearInterval(poll);
      client.logout().catch(() => client.close());
    };
    // Writes are queued so the timers and the IMAP handlers cannot interleave. A failed write means the browser is
    // gone, so the IMAP connection is closed rather than left idling forever.
    let writes: Promise<void> = Promise.resolve();
    const send = (event: MailEvent): Promise<void> => {
      if (closed) return writes;
      writes = writes
        .then(() => (closed ? undefined : stream.writeSSE({ data: JSON.stringify(event), event: event.type })))
        .catch(() => cleanup());
      return writes;
    };
    stream.onAbort(cleanup);
    client.on("close", cleanup);
    ping = setInterval(() => void send({ type: "ping" }), 25_000);

    try {
      const box = await client.mailboxOpen("INBOX");
      let nextUid = box.uidNext || 1;
      // ImapFlow runs one command at a time and `exists` can fire again while a
      // scan is still reading, so each scan queues behind the previous one.
      let scans: Promise<void> = Promise.resolve();
      const queue = (fn: () => Promise<void>) => {
        scans = scans
          .then(async () => {
            if (closed || !client.usable) return;
            await fn();
          })
          .catch((err: unknown) => log.debug(`event handler failed for ${user.email}: ${(err as Error).message}`));
      };
      const scan = () =>
        queue(async () => {
          const found: Array<{ uid: number; from: Address | null; subject: string }> = [];
          for await (const m of client.fetch({ uid: `${nextUid}:*` }, { uid: true, envelope: true }, { uid: true })) {
            if (m.uid < nextUid) continue;
            const f = m.envelope?.from?.[0];
            found.push({ uid: m.uid, from: f?.address ? { name: f.name ?? "", address: f.address } : null, subject: m.envelope?.subject ?? "" });
            nextUid = Math.max(nextUid, m.uid + 1);
          }
          for (const f of found) await send({ type: "new", folder: "INBOX", uid: f.uid, from: f.from, subject: f.subject });
          if (found.length) await send({ type: "folders" });
        });
      client.on("exists", scan);
      // Without QRESYNC an expunge only carries a sequence number; the client then refreshes the whole folder.
      client.on("expunge", (ev: { uid?: number }) => {
        void send(ev.uid ? { type: "expunge", folder: "INBOX", uid: ev.uid } : { type: "folder", folder: "INBOX" });
        void send({ type: "folders" });
      });
      client.on("flags", (ev: { uid?: number; flags: Set<string> }) => {
        void send(ev.uid ? { type: "flags", folder: "INBOX", uid: ev.uid, flags: [...ev.flags] } : { type: "folder", folder: "INBOX" });
        void send({ type: "folders" });
      });

      let snapshot = await folderSnapshot(client);
      poll = setInterval(
        () =>
          queue(async () => {
            const next = await folderSnapshot(client);
            const changed = [...next].filter(([path, sig]) => path !== "INBOX" && snapshot.get(path) !== sig).map(([path]) => path);
            const listChanged = next.size !== snapshot.size || [...snapshot.keys()].some((p) => !next.has(p));
            snapshot = next;
            for (const folder of changed) await send({ type: "folder", folder });
            if (changed.length || listChanged) await send({ type: "folders" });
          }),
        FOLDER_POLL_MS,
      );
      // Anything that arrived between the client's first load and now produced no event; "ready" tells it to resync.
      await send({ type: "ready" });
      // Keep the handler alive until the client goes away; imapflow auto-IDLEs while we wait.
      while (!closed && client.usable) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      log.debug(`event stream for ${user.email} ended: ${(err as Error).message}`);
    } finally {
      cleanup();
    }
  });
}
