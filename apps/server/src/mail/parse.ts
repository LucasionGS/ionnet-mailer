import PostalMime, { type Email, type Address as PmAddress } from "postal-mime";
import type { Address, Attachment, Message } from "@ionnet/shared";

export interface ParsedMessage {
  email: Email;
  message: Message;
  /** Attachment binary contents indexed by partId. */
  parts: Map<string, { content: Buffer; contentType: string; filename: string }>;
}

export function flattenAddresses(list: PmAddress[] | undefined): Address[] {
  const out: Address[] = [];
  for (const a of list ?? []) {
    if (a.group) {
      for (const m of a.group) out.push({ name: m.name ?? "", address: m.address ?? "" });
    } else if (a.address) out.push({ name: a.name ?? "", address: a.address });
  }
  return out;
}

export function parseMessageIds(value: string | undefined | null): string[] {
  if (!value) return [];
  return (value.match(/<[^>]+>/g) ?? []).map((s) => s.trim());
}

export function textSnippet(text: string | undefined | null, html: string | undefined | null, max = 160): string {
  let src = text?.trim();
  if (!src && html) {
    src = html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"');
  }
  return (src ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const REMOTE_RE = /(?:src|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i;
const CSS_URL_RE = /url\(\s*["']?\s*(?:https?:)?\/\//i;

function header(email: Email, key: string): string | null {
  const h = email.headers.find((x) => x.key === key.toLowerCase());
  return h?.value ?? null;
}

function parseAuth(email: Email): Message["authentication"] {
  const results = email.headers.filter((h) => h.key === "authentication-results").map((h) => h.value).join(";");
  const pick = (k: string) => results.match(new RegExp(`(?:^|[;\\s])${k}=([a-z]+)`, "i"))?.[1]?.toLowerCase() ?? null;
  let spamScore: number | null = null;
  const spamd = header(email, "x-spamd-result") ?? header(email, "x-spam-status") ?? "";
  const m = spamd.match(/\[(-?\d+(?:\.\d+)?)\s*\//) ?? spamd.match(/score=(-?\d+(?:\.\d+)?)/i);
  if (m) spamScore = Number(m[1]);
  else {
    const xs = header(email, "x-spam-score");
    if (xs && !Number.isNaN(Number(xs))) spamScore = Number(xs);
  }
  return { spf: pick("spf"), dkim: pick("dkim"), dmarc: pick("dmarc"), spamScore };
}

export function attachmentUrl(folder: string, uid: number, partId: string): string {
  return `/api/mail/messages/${encodeURIComponent(folder)}/${uid}/attachments/${encodeURIComponent(partId)}`;
}

export async function parseRaw(raw: Buffer, folder: string, uid: number, flags: Set<string>, size: number): Promise<ParsedMessage> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const parts = new Map<string, { content: Buffer; contentType: string; filename: string }>();
  const attachments: Attachment[] = [];

  email.attachments.forEach((a, i) => {
    const partId = String(i + 1);
    const contentType = a.mimeType || "application/octet-stream";
    const filename = a.filename || `attachment-${partId}${extFor(contentType)}`;
    const content = Buffer.from(a.content as ArrayBuffer);
    parts.set(partId, { content, contentType, filename });
    attachments.push({
      partId,
      filename,
      contentType,
      size: content.byteLength,
      contentId: a.contentId ? a.contentId.replace(/^<|>$/g, "") : null,
      inline: a.disposition === "inline" || (!!a.contentId && !!a.related),
      url: attachmentUrl(folder, uid, partId),
    });
  });

  let html = email.html ?? null;
  if (html) {
    for (const att of attachments) {
      if (att.contentId) {
        html = html.split(`cid:${att.contentId}`).join(att.url);
      }
    }
  }
  const hasRemoteContent = !!html && (REMOTE_RE.test(html) || CSS_URL_RE.test(html));
  const from = flattenAddresses(email.from ? [email.from] : [])[0] ?? null;
  const date = email.date ? new Date(email.date) : new Date();
  const listUnsub = header(email, "list-unsubscribe");

  const message: Message = {
    uid,
    folder,
    messageId: email.messageId ?? null,
    inReplyTo: parseMessageIds(email.inReplyTo)[0] ?? null,
    references: parseMessageIds(email.references),
    from,
    to: flattenAddresses(email.to),
    cc: flattenAddresses(email.cc),
    bcc: flattenAddresses(email.bcc),
    replyTo: flattenAddresses(email.replyTo),
    subject: email.subject ?? "",
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    flags: [...flags],
    unread: !flags.has("\\Seen"),
    flagged: flags.has("\\Flagged"),
    answered: flags.has("\\Answered"),
    draft: flags.has("\\Draft"),
    size,
    hasAttachments: attachments.some((a) => !a.inline),
    snippet: textSnippet(email.text, email.html),
    html,
    text: email.text ?? null,
    attachments,
    hasRemoteContent,
    listUnsubscribe: listUnsub ? (listUnsub.match(/<(https?:[^>]+)>/)?.[1] ?? listUnsub.match(/<(mailto:[^>]+)>/)?.[1] ?? null) : null,
    authentication: parseAuth(email),
  };
  return { email, message, parts };
}

function extFor(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/html": ".html",
    "message/rfc822": ".eml",
  };
  return map[contentType.toLowerCase()] ?? "";
}
