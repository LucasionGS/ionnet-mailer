import type { Message, Me } from "@ionnet/shared";
import type { ComposerInit, Recipient } from "./composerStore";
import { escapeHtml, formatDateLong, textToHtml } from "@/lib/utils";

function sameAddress(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function dedupe(list: Recipient[], exclude: string[] = []): Recipient[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const out: Recipient[] = [];
  for (const r of list) {
    const k = r.address.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function quoteHeader(m: Message): string {
  const who = m.from ? (m.from.name ? `${escapeHtml(m.from.name)} &lt;${escapeHtml(m.from.address)}&gt;` : escapeHtml(m.from.address)) : "unknown";
  return `On ${escapeHtml(formatDateLong(m.date))}, ${who} wrote:`;
}

function bodyHtml(m: Message): string {
  if (m.html) return m.html;
  if (m.text) return textToHtml(m.text);
  return "";
}

export function quotedBlock(m: Message): string {
  return `<p></p><p></p><div class="ionnet-quote"><p>${quoteHeader(m)}</p><blockquote>${bodyHtml(m)}</blockquote></div>`;
}

function forwardHeader(m: Message): string {
  const line = (label: string, v: string) => `<b>${label}:</b> ${escapeHtml(v)}<br>`;
  const addr = (a: { name: string; address: string }) => (a.name ? `${a.name} <${a.address}>` : a.address);
  return (
    `<p></p><p></p><div class="ionnet-forward"><p>---------- Forwarded message ---------<br>` +
    (m.from ? line("From", addr(m.from)) : "") +
    line("Date", formatDateLong(m.date)) +
    line("Subject", m.subject) +
    (m.to.length ? line("To", m.to.map(addr).join(", ")) : "") +
    (m.cc.length ? line("Cc", m.cc.map(addr).join(", ")) : "") +
    `</p>${bodyHtml(m)}</div>`
  );
}

/**
 * Add the signature, untouched, to the composed body: above the quoted/forwarded original if there is one,
 * otherwise at the end. It never goes through the editor, which would strip tables, styles and the like.
 */
export function withSignature(html: string, signature: string): string {
  const sig = signature.includes("<") ? signature : textToHtml(signature);
  const block = `<div class="ionnet-signature">-- <br>${sig}</div>`;
  const quote = /<div class="ionnet-(?:quote|forward)">/.exec(html);
  return quote ? html.slice(0, quote.index) + block + html.slice(quote.index) : html + block;
}

/** Drafts are saved with the signature included; take it back out so it doesn't end up in the editor. */
function withoutSignature(html: string): { html: string; signature: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sig = doc.body.querySelector(":scope > .ionnet-signature");
  if (!sig) return { html, signature: false };
  sig.remove();
  return { html: doc.body.innerHTML, signature: true };
}

function rePrefix(subject: string, prefix: "Re" | "Fwd"): string {
  const s = subject.trim();
  const re = prefix === "Re" ? /^(re|aw|sv|antw)\s*:/i : /^(fwd?|wg|tr)\s*:/i;
  return re.test(s) ? s : `${prefix}: ${s}`;
}

export function replyInit(m: Message, me: Me, all: boolean): ComposerInit {
  const replyTarget = m.replyTo.length ? m.replyTo : m.from ? [m.from] : [];
  const to = dedupe(replyTarget, [me.email]);
  const cc = all ? dedupe([...m.to, ...m.cc], [me.email, ...to.map((t) => t.address)]) : [];
  // If we are replying to ourselves (e.g. from Sent), address the original recipients.
  const finalTo = to.length ? to : dedupe(m.to, [me.email]);
  return {
    mode: all ? "replyAll" : "reply",
    to: finalTo,
    cc,
    subject: rePrefix(m.subject, "Re"),
    html: quotedBlock(m),
    inReplyTo: { folder: m.folder, uid: m.uid },
    replyMode: "reply",
    original: m,
  };
}

export function forwardInit(m: Message): ComposerInit {
  return {
    mode: "forward",
    to: [],
    subject: rePrefix(m.subject, "Fwd"),
    html: forwardHeader(m),
    inReplyTo: { folder: m.folder, uid: m.uid },
    replyMode: "forward",
    forwardAttachments: m.attachments
      .filter((a) => !a.inline)
      .map((a) => ({ ref: { folder: m.folder, uid: m.uid }, partId: a.partId, filename: a.filename, size: a.size })),
    original: m,
  };
}

export function draftInit(m: Message): ComposerInit {
  const body = withoutSignature(m.html ?? (m.text ? textToHtml(m.text) : ""));
  return {
    mode: "draft",
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject,
    html: body.html,
    signature: body.signature,
    draftUid: m.uid,
    original: m,
  };
}

export function isSelf(me: Me, address: string) {
  return sameAddress(me.email, address);
}
