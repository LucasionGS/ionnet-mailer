import { Hono } from "hono";
import { stream } from "hono/streaming";
import {
  DeleteRequestSchema,
  FlagRequestSchema,
  FolderCreateSchema,
  MoveRequestSchema,
  type Folder,
  type MessageRef,
  type Quota,
  type Thread,
} from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { requireAuth } from "../http/middleware.ts";
import { parseJson } from "../http/validate.ts";
import { badRequest, notFound } from "../errors.ts";
import { pool } from "./pool.ts";
import { findSpecialFolder, listFolders } from "./folders.ts";
import { listThreads, rootFromThreadId, threadUids } from "./threads.ts";
import { fetchRaw, invalidate, loadMessage, loadMessages } from "./message.ts";
import { mailEvents } from "./events.ts";
import { sendRoutes } from "../send/routes.ts";
import { quotaBytes } from "./usage.ts";

export const mailRoutes = new Hono<AppEnv>();
mailRoutes.use("*", requireAuth);

const folderParam = (raw: string) => {
  const f = decodeURIComponent(raw);
  if (!f || f.includes("\0")) throw badRequest("Invalid folder");
  return f;
};

/** Groups refs by folder so each folder is opened once. */
function byFolder(refs: MessageRef[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const r of refs) m.set(r.folder, [...(m.get(r.folder) ?? []), r.uid]);
  return m;
}

mailRoutes.get("/folders", async (c) => {
  const folders = await pool.withClient(c.get("user"), listFolders, c.get("clientIp"));
  return c.json(folders);
});

mailRoutes.post("/folders", async (c) => {
  const { path } = await parseJson(c, FolderCreateSchema);
  const folder = await pool.withClient(c.get("user"), async (client) => {
    await client.mailboxCreate(path);
    await client.mailboxSubscribe(path).catch(() => undefined);
    const all = await listFolders(client);
    return all.find((f) => f.path === path) as Folder | undefined;
  });
  if (!folder) throw notFound("Folder was created but could not be listed");
  return c.json(folder, 201);
});

mailRoutes.delete("/folders/:path", async (c) => {
  const path = folderParam(c.req.param("path"));
  if (path.toUpperCase() === "INBOX") throw badRequest("Inbox cannot be deleted");
  await pool.withClient(c.get("user"), (client) => client.mailboxDelete(path));
  return c.json({ ok: true });
});

mailRoutes.get("/threads", async (c) => {
  const folder = c.req.query("folder") || "INBOX";
  const cursor = c.req.query("cursor") || undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const q = c.req.query("q") || undefined;
  const result = await pool.withClient(c.get("user"), (client) => listThreads(client, folder, { cursor, limit, q }), c.get("clientIp"));
  return c.json(result);
});

mailRoutes.get("/threads/:threadId", async (c) => {
  const folder = c.req.query("folder") || "INBOX";
  const root = rootFromThreadId(c.req.param("threadId"));
  const user = c.get("user");
  const thread = await pool.withClient(user, async (client): Promise<Thread> => {
    const uids = await threadUids(client, folder, root);
    if (!uids.length) throw notFound("Thread not found");
    const messages = await loadMessages(client, user.id, folder, uids);
    messages.sort((a, b) => a.date.localeCompare(b.date));
    return { id: c.req.param("threadId"), subject: messages[messages.length - 1]?.subject ?? "", messages };
  });
  return c.json(thread);
});

mailRoutes.get("/messages/:folder/:uid", async (c) => {
  const folder = folderParam(c.req.param("folder"));
  const uid = Number(c.req.param("uid"));
  if (!Number.isInteger(uid) || uid < 1) throw badRequest("Invalid uid");
  const user = c.get("user");
  const parsed = await pool.withClient(user, (client) => loadMessage(client, user.id, folder, uid), c.get("clientIp"));
  return c.json(parsed.message);
});

mailRoutes.get("/messages/:folder/:uid/raw", async (c) => {
  const folder = folderParam(c.req.param("folder"));
  const uid = Number(c.req.param("uid"));
  const { raw } = await pool.withClient(c.get("user"), (client) => fetchRaw(client, folder, uid));
  c.header("Content-Type", "message/rfc822");
  c.header("Content-Disposition", `attachment; filename="message-${uid}.eml"`);
  return c.body(new Uint8Array(raw));
});

mailRoutes.get("/messages/:folder/:uid/attachments/:partId", async (c) => {
  const folder = folderParam(c.req.param("folder"));
  const uid = Number(c.req.param("uid"));
  const partId = decodeURIComponent(c.req.param("partId"));
  const user = c.get("user");
  const parsed = await pool.withClient(user, (client) => loadMessage(client, user.id, folder, uid));
  const part = parsed.parts.get(partId);
  if (!part) throw notFound("Attachment not found");
  const inline = c.req.query("inline") === "1";
  const safeName = part.filename.replace(/["\r\n]/g, "_");
  c.header("Content-Type", part.contentType.startsWith("text/html") && !inline ? "application/octet-stream" : part.contentType);
  c.header("Content-Length", String(part.content.byteLength));
  c.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(part.filename)}`);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "sandbox; default-src 'none'");
  return stream(c, async (s) => {
    await s.write(part.content);
  });
});

mailRoutes.post("/messages/flags", async (c) => {
  const body = await parseJson(c, FlagRequestSchema);
  const user = c.get("user");
  await pool.withClient(user, async (client) => {
    for (const [folder, uids] of byFolder(body.messages)) {
      const lock = await client.getMailboxLock(folder);
      try {
        if (body.add.length) await client.messageFlagsAdd(uids, body.add, { uid: true });
        if (body.remove.length) await client.messageFlagsRemove(uids, body.remove, { uid: true });
      } finally {
        lock.release();
      }
      for (const uid of uids) invalidate(user.id, folder, uid);
    }
  });
  return c.json({ ok: true });
});

mailRoutes.post("/messages/move", async (c) => {
  const body = await parseJson(c, MoveRequestSchema);
  const user = c.get("user");
  await pool.withClient(user, async (client) => {
    for (const [folder, uids] of byFolder(body.messages)) {
      if (folder === body.destination) continue;
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageMove(uids, body.destination, { uid: true });
      } finally {
        lock.release();
      }
      for (const uid of uids) invalidate(user.id, folder, uid);
    }
  });
  return c.json({ ok: true });
});

mailRoutes.post("/messages/delete", async (c) => {
  const body = await parseJson(c, DeleteRequestSchema);
  const user = c.get("user");
  await pool.withClient(user, async (client) => {
    const trash = await findSpecialFolder(client, "trash");
    for (const [folder, uids] of byFolder(body.messages)) {
      const lock = await client.getMailboxLock(folder);
      try {
        if (body.permanent || folder === trash) await client.messageDelete(uids, { uid: true });
        else await client.messageMove(uids, trash, { uid: true });
      } finally {
        lock.release();
      }
      for (const uid of uids) invalidate(user.id, folder, uid);
    }
  });
  return c.json({ ok: true });
});

mailRoutes.get("/quota", async (c) => {
  const q = await pool.withClient(c.get("user"), (client) => client.getQuota("INBOX"));
  const quota: Quota = { usedBytes: q && q.storage ? quotaBytes(q.storage) : 0, limitBytes: q && q.storage ? q.storage.limit : 0 };
  return c.json(quota);
});

mailRoutes.get("/events", (c) => mailEvents(c, c.get("user"), c.get("clientIp")));

mailRoutes.route("/", sendRoutes);
