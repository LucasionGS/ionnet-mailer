import { Op, QueryTypes, type WhereOptions } from "sequelize";
import { decodeWords } from "postal-mime";
import type { MailDirection, MailLogEntry, MailLogStatus, Page } from "@ionnet/shared";
import { Domain, MailLogRow } from "../db/models.ts";
import { sequelize } from "../db/sequelize.ts";
import { likePattern, pageOf } from "./paging.ts";
import { parseEvent, parseLine, sourceOf, type PostfixEvent } from "./postfix-parse.ts";

/** What we know about a queued message before its delivery lines arrive. */
interface MessageContext {
  receivedAt: Date;
  sender: string | null;
  size: number | null;
  messageId: string | null;
  subject: string | null;
  clientHost: string | null;
  clientIp: string | null;
  source: string | null;
  saslUser: string | null;
  touched: number;
}

const contexts = new Map<string, MessageContext>();
// Deferred mail can sit in the queue for days (maximal_queue_lifetime is 5d by default).
const CONTEXT_TTL_MS = 6 * 86_400_000;

function context(qid: string, time: Date): MessageContext {
  let c = contexts.get(qid);
  if (!c) {
    c = { receivedAt: time, sender: null, size: null, messageId: null, subject: null, clientHost: null, clientIp: null, source: null, saslUser: null, touched: 0 };
    contexts.set(qid, c);
  }
  c.touched = Date.now();
  return c;
}

export function pruneContexts(): void {
  const cutoff = Date.now() - CONTEXT_TTL_MS;
  for (const [qid, c] of contexts) if (c.touched < cutoff) contexts.delete(qid);
}

let localDomains: { names: Set<string>; loadedAt: number } = { names: new Set(), loadedAt: 0 };
async function isLocalAddress(address: string): Promise<boolean> {
  if (Date.now() - localDomains.loadedAt > 60_000) {
    const rows = await Domain.findAll({ attributes: ["name"] });
    localDomains = { names: new Set(rows.map((d) => d.name.toLowerCase())), loadedAt: Date.now() };
  }
  return localDomains.names.has(address.split("@").pop()?.toLowerCase() ?? "");
}

/** Postfix logs the raw header; decode RFC 2047 words and drop the "?" it prints for folded lines. */
export function cleanSubject(raw: string): string {
  const unfolded = raw.replace(/\?=\?\s*=\?/g, "?==?").replace(/\?\s+/g, " ");
  try {
    return decodeWords(unfolded).slice(0, 500);
  } catch {
    return unfolded.slice(0, 500);
  }
}

function deliveryStatus(status: string, transport: string): MailLogStatus | null {
  switch (status) {
    case "sent":
      return transport === "lmtp" || transport === "virtual" || transport === "local" ? "delivered" : "sent";
    case "deferred":
    case "bounced":
    case "expired":
      return status;
    default:
      return null; // verify probes ("deliverable", "undeliverable") and anything new
  }
}

interface Upsert {
  queueId: string | null;
  recipient: string;
  direction: MailDirection;
  status: MailLogStatus;
  ctx: MessageContext | null;
  sender: string | null;
  origRecipient: string | null;
  relay: string | null;
  dsn: string | null;
  detail: string | null;
  source: string | null;
  clientHost: string | null;
  clientIp: string | null;
  at: Date;
}

async function upsert(u: Upsert): Promise<void> {
  const c = u.ctx;
  await sequelize.query(
    `INSERT INTO mail_log (queue_id, recipient, direction, status, sender, orig_recipient, message_id, subject, size,
                           client_host, client_ip, source, sasl_user, relay, dsn, detail, created_at, updated_at)
     VALUES (:queueId, :recipient, :direction, :status, :sender, :origRecipient, :messageId, :subject, :size,
             :clientHost, :clientIp, :source, :saslUser, :relay, :dsn, :detail, :createdAt, :at)
     ON CONFLICT (queue_id, recipient) DO UPDATE SET
       status = EXCLUDED.status,
       relay = EXCLUDED.relay,
       dsn = EXCLUDED.dsn,
       detail = EXCLUDED.detail,
       attempts = mail_log.attempts + 1,
       updated_at = EXCLUDED.updated_at,
       message_id = COALESCE(mail_log.message_id, EXCLUDED.message_id),
       subject = COALESCE(mail_log.subject, EXCLUDED.subject),
       size = COALESCE(mail_log.size, EXCLUDED.size),
       client_host = COALESCE(mail_log.client_host, EXCLUDED.client_host),
       client_ip = COALESCE(mail_log.client_ip, EXCLUDED.client_ip),
       sasl_user = COALESCE(mail_log.sasl_user, EXCLUDED.sasl_user)`,
    {
      replacements: {
        queueId: u.queueId,
        recipient: u.recipient.slice(0, 254),
        direction: u.direction,
        status: u.status,
        sender: (u.sender ?? c?.sender ?? "").slice(0, 254),
        origRecipient: u.origRecipient?.slice(0, 254) ?? null,
        messageId: c?.messageId?.slice(0, 512) ?? null,
        subject: c?.subject ?? null,
        size: c?.size ?? null,
        clientHost: (u.clientHost ?? c?.clientHost)?.slice(0, 255) ?? null,
        clientIp: (u.clientIp ?? c?.clientIp)?.slice(0, 64) ?? null,
        source: u.source ?? c?.source ?? null,
        saslUser: c?.saslUser?.slice(0, 254) ?? null,
        relay: u.relay?.slice(0, 255) ?? null,
        dsn: u.dsn,
        detail: u.detail,
        createdAt: c?.receivedAt ?? u.at,
        at: u.at,
      },
      type: QueryTypes.INSERT,
    },
  );
}

/** After an app restart the context is gone; earlier rows of the same message still carry it. */
async function contextFromDb(qid: string, at: Date): Promise<MessageContext | null> {
  const row = await MailLogRow.findOne({ where: { queueId: qid }, order: [["id", "ASC"]] });
  if (!row) return null;
  const c = context(qid, row.createdAt);
  Object.assign(c, {
    sender: row.sender,
    size: row.size,
    messageId: row.messageId,
    subject: row.subject,
    clientHost: row.clientHost,
    clientIp: row.clientIp,
    source: row.source,
    saslUser: row.saslUser,
  });
  c.touched = at.getTime();
  return c;
}

async function apply(e: PostfixEvent, time: Date, syslogName: string): Promise<void> {
  switch (e.kind) {
    case "client": {
      const c = context(e.qid, time);
      Object.assign(c, { clientHost: e.clientHost, clientIp: e.clientIp, saslUser: e.saslUser, source: sourceOf(syslogName), receivedAt: time });
      return;
    }
    case "pickup": {
      const c = context(e.qid, time);
      Object.assign(c, { sender: e.sender, source: "local", receivedAt: time });
      return;
    }
    case "message-id":
      context(e.qid, time).messageId = e.messageId;
      return;
    case "subject":
      context(e.qid, time).subject = cleanSubject(e.subject);
      return;
    case "queued": {
      const c = context(e.qid, time);
      c.sender = e.sender;
      c.size = e.size;
      return;
    }
    case "removed":
      contexts.delete(e.qid);
      return;
    case "expired":
      await MailLogRow.update({ status: "expired", updatedAt: time }, { where: { queueId: e.qid, status: "deferred" } });
      return;
    case "deleted":
      contexts.delete(e.qid);
      await MailLogRow.update({ status: "deleted", updatedAt: time }, { where: { queueId: e.qid, status: "deferred" } });
      return;
    case "delivery": {
      const status = deliveryStatus(e.status, e.transport);
      if (!status) return;
      const ctx = contexts.get(e.qid) ?? (await contextFromDb(e.qid, time));
      const direction: MailDirection = e.transport === "lmtp" || (await isLocalAddress(e.to)) ? "in" : "out";
      await upsert({
        queueId: e.qid,
        recipient: e.to,
        direction,
        status,
        ctx,
        sender: null,
        origRecipient: e.origTo,
        relay: e.relay === "none" ? null : e.relay,
        dsn: e.dsn,
        detail: e.detail,
        source: null,
        clientHost: null,
        clientIp: null,
        at: time,
      });
      return;
    }
    case "reject": {
      const rcpt = e.to ?? "";
      const ctx = e.qid ? (contexts.get(e.qid) ?? null) : null;
      await upsert({
        queueId: e.qid,
        recipient: rcpt,
        direction: rcpt && (await isLocalAddress(rcpt)) ? "in" : "out",
        status: "rejected",
        ctx,
        sender: e.from,
        origRecipient: null,
        relay: null,
        dsn: e.dsn,
        detail: `${e.stage}: ${e.detail}`,
        source: sourceOf(syslogName),
        clientHost: e.clientHost,
        clientIp: e.clientIp,
        at: time,
      });
      return;
    }
  }
}

/** Feeds one line of Postfix's log into the mail log. */
export async function ingestPostfixLine(line: string): Promise<void> {
  const l = parseLine(line);
  if (!l) return;
  const e = parseEvent(l);
  if (e) await apply(e, l.time, l.syslogName);
}

// ---- queries ------------------------------------------------------------------
export function toMailLogDto(r: MailLogRow): MailLogEntry {
  return {
    id: String(r.id),
    queueId: r.queueId,
    messageId: r.messageId,
    direction: r.direction as MailDirection,
    status: r.status as MailLogStatus,
    sender: r.sender,
    recipient: r.recipient,
    origRecipient: r.origRecipient,
    subject: r.subject,
    size: r.size,
    clientHost: r.clientHost,
    clientIp: r.clientIp,
    source: r.source,
    saslUser: r.saslUser,
    relay: r.relay,
    dsn: r.dsn,
    detail: r.detail,
    attempts: r.attempts,
    firstAt: r.createdAt.toISOString(),
    lastAt: r.updatedAt.toISOString(),
  };
}

export interface MailLogFilter {
  direction?: MailDirection;
  /** a single status, or "problems" for deferred + bounced + expired */
  status?: MailLogStatus | "problems";
  q?: string;
  before?: string;
  limit: number;
}

export async function listMailLog(f: MailLogFilter): Promise<Page<MailLogEntry>> {
  const where: WhereOptions<MailLogRow>[] = [];
  if (f.direction) where.push({ direction: f.direction });
  if (f.status === "problems") where.push({ status: { [Op.in]: ["deferred", "bounced", "expired"] } });
  else if (f.status) where.push({ status: f.status });
  if (f.q) {
    const q = f.q.trim();
    const p = likePattern(q);
    where.push({
      [Op.or]: [
        { sender: { [Op.iLike]: p } },
        { recipient: { [Op.iLike]: p } },
        { origRecipient: { [Op.iLike]: p } },
        { subject: { [Op.iLike]: p } },
        { messageId: { [Op.iLike]: p } },
        { queueId: q },
        { clientIp: { [Op.startsWith]: q } },
      ],
    });
  }
  if (f.before) where.push({ id: { [Op.lt]: f.before } });
  const rows = await MailLogRow.findAll({ where: { [Op.and]: where }, order: [["id", "DESC"]], limit: f.limit + 1 });
  return pageOf(rows, f.limit, toMailLogDto);
}
