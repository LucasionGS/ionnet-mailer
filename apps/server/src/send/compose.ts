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

/** Text for HTML outside <pre>: source whitespace isn't significant there, so pretty-printed markup (e.g. a table signature) doesn't leak its indentation. */
function flowToText(html: string): string {
  return html
    .replace(/[ \t\r\n\f]+/g, " ")
    .replace(/<div class="ionnet-signature"[^>]*>/gi, "\n-- \n") // the HTML divider line, as the standard plain-text delimiter
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|table|blockquote)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ +/gm, "")
    .replace(/(?<!^--) +$/gm, ""); // keep the "-- " signature delimiter intact
}

export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .split(/(<pre\b[\s\S]*?<\/pre>)/i)
    .map((part, i) => (i % 2 ? `\n${part.replace(/<[^>]+>/g, "")}\n` : flowToText(part)))
    .join("")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
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
