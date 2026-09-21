import { Hono, type Context } from "hono";
import nodemailer from "nodemailer";
import { Op } from "sequelize";
import { DraftRequestSchema, SendRequestSchema, type Address } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { config } from "../config.ts";
import { ContactRow, MailboxRow, RecentAddress } from "../db/models.ts";
import { badRequest, forbidden } from "../errors.ts";
import { parseWith } from "../http/validate.ts";
import { pool } from "../mail/pool.ts";
import { findSpecialFolder } from "../mail/folders.ts";
import { loadMessage, invalidate } from "../mail/message.ts";
import { buildMime, type ComposeInput } from "./compose.ts";
import { allowedSenders } from "./senders.ts";
import { logger } from "../logger.ts";

const log = logger("send");
export const sendRoutes = new Hono<AppEnv>();

const MAX_UPLOAD = 25 * 1024 * 1024;

async function readForm(c: Context<AppEnv>) {
  const body = await c.req.parseBody({ all: true });
  const payloadRaw = body["payload"];
  if (typeof payloadRaw !== "string") throw badRequest('Missing "payload" form field');
  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    throw badRequest('"payload" must be JSON');
  }
  const filesRaw = body["files"];
  const files = (Array.isArray(filesRaw) ? filesRaw : filesRaw ? [filesRaw] : []).filter((f): f is File => f instanceof File);
  let total = 0;
  const uploads = [];
  for (const f of files) {
    total += f.size;
    if (total > MAX_UPLOAD) throw badRequest("Attachments exceed the 25 MB limit");
    uploads.push({ filename: f.name || "attachment", contentType: f.type || "application/octet-stream", content: Buffer.from(await f.arrayBuffer()) });
  }
  return { payload, uploads };
}

async function resolveFrom(user: MailboxRow, fromAddress?: string, fromName?: string): Promise<Address> {
  const address = (fromAddress ?? user.email).toLowerCase();
  if (!(await allowedSenders(user)).includes(address)) throw forbidden(`You are not allowed to send as ${address}`);
  return { name: fromName ?? user.displayName, address };
}

async function collectForwarded(user: MailboxRow, refs: Array<{ ref: { folder: string; uid: number }; partId: string }>) {
  const out: ComposeInput["forwarded"] = [];
  for (const { ref, partId } of refs) {
    const parsed = await pool.withClient(user, (client) => loadMessage(client, user.id, ref.folder, ref.uid));
    const part = parsed.parts.get(partId);
    if (part) out.push(part);
  }
  return out;
}

async function originalHeaders(user: MailboxRow, ref: { folder: string; uid: number } | null) {
  if (!ref) return null;
  const parsed = await pool.withClient(user, (client) => loadMessage(client, user.id, ref.folder, ref.uid));
  return { messageId: parsed.message.messageId, references: parsed.message.references };
}

async function rememberRecipients(user: MailboxRow, recipients: Address[]) {
  for (const r of recipients) {
    const address = r.address.toLowerCase();
    const [row, created] = await RecentAddress.findOrCreate({
      where: { mailboxId: user.id, address },
      defaults: { mailboxId: user.id, address, name: r.name, lastUsedAt: new Date(), uses: 1 },
    });
    if (!created) {
      row.uses += 1;
      row.lastUsedAt = new Date();
      if (r.name) row.name = r.name;
      await row.save();
    }
    const existing = await ContactRow.findOne({ where: { mailboxId: user.id, emails: { [Op.contains]: [address] } } });
    if (!existing) {
      await ContactRow.create({ mailboxId: user.id, name: r.name || address, emails: [address], source: "auto" });
    }
  }
}

sendRoutes.post("/send", async (c) => {
  const user = c.get("user");
  const { payload, uploads } = await readForm(c);
  const req = parseWith(SendRequestSchema, payload);
  const from = await resolveFrom(user, req.fromAddress, req.fromName);
  const [forwarded, original] = await Promise.all([collectForwarded(user, req.forwardAttachments), originalHeaders(user, req.inReplyTo)]);
  const { raw, messageId, envelope } = await buildMime({ req, from, domain: user.email.split("@")[1]!, uploads, forwarded, original });

  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false, ignoreTLS: true, name: config.MAIL_HOSTNAME });
  try {
    await transport.sendMail({ envelope, raw });
  } catch (err) {
    log.error(`SMTP submission failed for ${user.email}`, err);
    throw badRequest(`Could not hand the message to the mail server: ${(err as Error).message}`);
  }

  await pool.withClient(user, async (client) => {
    const sent = await findSpecialFolder(client, "sent");
    await client.append(sent, raw, ["\\Seen"]);
    if (req.inReplyTo && req.replyMode) {
      const lock = await client.getMailboxLock(req.inReplyTo.folder);
      try {
        await client.messageFlagsAdd([req.inReplyTo.uid], [req.replyMode === "reply" ? "\\Answered" : "$Forwarded"], { uid: true });
      } finally {
        lock.release();
      }
      invalidate(user.id, req.inReplyTo.folder, req.inReplyTo.uid);
    }
    if (req.draftUid) {
      const drafts = await findSpecialFolder(client, "drafts");
      const lock = await client.getMailboxLock(drafts);
      try {
        await client.messageDelete([req.draftUid], { uid: true });
      } finally {
        lock.release();
      }
    }
  });
  await rememberRecipients(user, [...req.to, ...req.cc, ...req.bcc]).catch((err) => log.warn("could not record recipients", err));
  return c.json({ ok: true, messageId });
});

sendRoutes.put("/drafts", async (c) => {
  const user = c.get("user");
  const { payload, uploads } = await readForm(c);
  const req = parseWith(DraftRequestSchema, payload);
  const from = await resolveFrom(user, req.fromAddress, req.fromName);
  const [forwarded, original] = await Promise.all([collectForwarded(user, req.forwardAttachments), originalHeaders(user, req.inReplyTo)]);
  const { raw, messageId } = await buildMime({ req, from, domain: user.email.split("@")[1]!, uploads, forwarded, original });

  const uid = await pool.withClient(user, async (client) => {
    const drafts = await findSpecialFolder(client, "drafts");
    const res = await client.append(drafts, raw, ["\\Draft", "\\Seen"]);
    const lock = await client.getMailboxLock(drafts);
    try {
      if (req.draftUid) await client.messageDelete([req.draftUid], { uid: true }).catch(() => undefined);
      if (res && res.uid) return res.uid;
      const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
      return found && found.length ? found[found.length - 1]! : 0;
    } finally {
      lock.release();
    }
  });
  return c.json({ uid });
});
