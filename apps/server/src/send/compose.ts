import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type Mail from "nodemailer/lib/mailer/index.js";
import type { Address, DraftRequest, SendRequest } from "@ionnet/shared";

export interface ComposeInput {
  req: SendRequest | DraftRequest;
  from: Address;
  domain: string;
  uploads: Array<{ filename: string; contentType: string; content: Buffer }>;
  forwarded: Array<{ filename: string; contentType: string; content: Buffer }>;
  original: { messageId: string | null; references: string[] } | null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const fmt = (a: { name?: string; address: string }) => (a.name ? { name: a.name, address: a.address } : a.address);

export async function buildMime(input: ComposeInput): Promise<{ raw: Buffer; messageId: string; envelope: { from: string; to: string[] } }> {
  const { req, from, domain, original } = input;
  const messageId = `<${randomUUID()}@${domain}>`;
  const references = original ? [...original.references, ...(original.messageId ? [original.messageId] : [])] : [];
  const html = req.html?.trim() ? req.html : undefined;
  const text = req.text?.trim() ? req.text : html ? htmlToText(html) : "";
  const attachments: Mail.Attachment[] = [...input.uploads, ...input.forwarded].map((a) => ({
    filename: a.filename,
    content: a.content,
    contentType: a.contentType,
  }));
  const options: Mail.Options = {
    from: fmt(from),
    to: (req.to ?? []).map(fmt),
    cc: req.cc.map(fmt),
    bcc: req.bcc.map(fmt),
    subject: req.subject,
    text,
    html,
    attachments,
    messageId,
    date: new Date(),
    inReplyTo: original?.messageId ?? undefined,
    references: references.length ? references : undefined,
    headers: req.requestReadReceipt ? { "Disposition-Notification-To": from.address } : undefined,
  };
  const raw = await new MailComposer(options).compile().build();
  const to = [...(req.to ?? []), ...req.cc, ...req.bcc].map((r) => r.address);
  return { raw, messageId, envelope: { from: from.address, to } };
}
