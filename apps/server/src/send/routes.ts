import { Hono, type Context } from "hono";
import nodemailer from "nodemailer";
import { Op } from "sequelize";
import type { ImapFlow } from "imapflow";
import { DraftRequestSchema, SendRequestSchema, type Address, type DraftResult, type SendRequest } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { config } from "../config.ts";
import { ContactRow, MailboxRow, RecentAddress } from "../db/models.ts";
import { badRequest, forbidden } from "../errors.ts";
import { parseWith } from "../http/validate.ts";
import { lockFolder, pool } from "../mail/pool.ts";
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

/** Flags the message a reply or forward answers: by reference, or for a reopened draft by its Message-ID in INBOX. */
async function markOriginal(client: ImapFlow, user: MailboxRow, req: SendRequest) {
  const flag = req.replyMode === "forward" ? "$Forwarded" : "\\Answered";
  let target = req.inReplyTo;
  if (!target && req.threadHeaders?.inReplyTo) {
    const lock = await lockFolder(client, "INBOX");
    try {
      const found = await client.search({ header: { "message-id": req.threadHeaders.inReplyTo } }, { uid: true });
      if (found && found.length) target = { folder: "INBOX", uid: found[found.length - 1]! };
    } finally {
      lock.release();
    }
  }
  if (!target || (req.inReplyTo && !req.replyMode)) return;
  const lock = await lockFolder(client, target.folder);
  try {
    await client.messageFlagsAdd([target.uid], [flag], { uid: true });
  } finally {
    lock.release();
  }
  invalidate(user.id, target.folder, target.uid);
}

sendRoutes.post("/send", async (c) => {
  const user = c.get("user");
  const { payload, uploads } = await readForm(c);
  const req = parseWith(SendRequestSchema, payload);
  const from = await resolveFrom(user, req.fromAddress, req.fromName);
  const [forwarded, original] = await Promise.all([collectForwarded(user, req.forwardAttachments), originalHeaders(user, req.inReplyTo)]);
  const { raw, copy, messageId, envelope } = await buildMime({ req, from, domain: user.email.split("@")[1]!, uploads, forwarded, original });

  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false, ignoreTLS: true, name: config.MAIL_HOSTNAME });
  // Postfix turns individual recipients away (send-only mailboxes); the rest still get the message.
  let rejected: string[];
  try {
    const info = await transport.sendMail({ envelope, raw });
    rejected = info.rejected ?? [];
  } catch (err) {
    log.error(`SMTP submission failed for ${user.email}`, err);
    throw badRequest(`Could not hand the message to the mail server: ${(err as Error).message}`);
  }

  // The message is on its way: nothing below may turn this into an error, or the user would send it again.
  let warning: string | undefined;
  await pool
    .withClient(user, async (client) => {
      const sent = await findSpecialFolder(client, "sent");
      await client.append(sent, copy, ["\\Seen"]).catch((err: Error) => {
        warning = "The message was sent, but a copy could not be saved in Sent (is the mailbox full?).";
        log.warn(`could not save sent copy for ${user.email}: ${err.message}`);
      });
      await markOriginal(client, user, req).catch((err: Error) => log.warn(`could not flag the original of a reply: ${err.message}`));
      if (req.draftUid) {
        const drafts = await findSpecialFolder(client, "drafts");
        const lock = await lockFolder(client, drafts);
        try {
          await client.messageDelete([req.draftUid], { uid: true });
        } finally {
          lock.release();
        }
      }
    })
    .catch((err: Error) => log.warn(`post-send cleanup failed for ${user.email}: ${err.message}`));
  await rememberRecipients(user, [...req.to, ...req.cc, ...req.bcc]).catch((err) => log.warn("could not record recipients", err));
  return c.json({ ok: true, messageId, rejected, ...(warning ? { warning } : {}) });
});

sendRoutes.put("/drafts", async (c) => {
  const user = c.get("user");
  const { payload, uploads } = await readForm(c);
  const req = parseWith(DraftRequestSchema, payload);
  const from = await resolveFrom(user, req.fromAddress, req.fromName);
  const [forwarded, original] = await Promise.all([collectForwarded(user, req.forwardAttachments), originalHeaders(user, req.inReplyTo)]);
  const { copy, messageId } = await buildMime({ req, from, domain: user.email.split("@")[1]!, uploads, forwarded, original });

  const result = await pool.withClient(user, async (client): Promise<DraftResult> => {
    const drafts = await findSpecialFolder(client, "drafts");
    const res = await client.append(drafts, copy, ["\\Draft", "\\Seen"]);
    let uid = 0;
    const lock = await lockFolder(client, drafts);
    try {
      if (req.draftUid) await client.messageDelete([req.draftUid], { uid: true }).catch(() => undefined);
      if (res && res.uid) uid = res.uid;
      else {
        const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
        uid = found && found.length ? found[found.length - 1]! : 0;
      }
    } finally {
      lock.release();
    }
    if (!uid) return { uid, attachments: [] };
    // Attachments now live in the draft; later saves copy them from here instead of uploading them again.
    const parsed = await loadMessage(client, user.id, drafts, uid);
    const attachments = parsed.message.attachments
      .filter((a) => !a.inline)
      .map((a) => ({ ref: { folder: drafts, uid }, partId: a.partId, filename: a.filename, size: a.size }));
    return { uid, attachments };
  });
  return c.json(result);
});
