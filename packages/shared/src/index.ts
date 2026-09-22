/**
 * Ionnet Mailer — shared API contract.
 *
 * Every request/response shape exchanged between `apps/server` and `apps/web`
 * is defined here with zod so both sides validate against the same source.
 *
 * Route map (all under /api, JSON, cookie session unless noted):
 *
 *  Public / setup
 *   GET  /api/setup/status                      -> SetupStatus
 *   POST /api/setup/verify-token                { token }                 -> { ok }
 *   POST /api/setup/check-hostname              SetupHostnameCheckRequest -> SetupHostnameCheckResult   (token header: X-Setup-Token)
 *   POST /api/setup/create                      SetupCreateRequest        -> { domainId, mailboxId }    (token header)
 *   GET  /api/setup/dns/:domainId               -> DnsCheckResult                                    (token header)
 *   POST /api/setup/finish                      -> { ok }                                            (token header)
 *
 *  Auth
 *   POST /api/auth/login                        LoginRequest -> Me
 *   POST /api/auth/logout                       -> { ok }
 *   GET  /api/auth/me                           -> Me
 *
 *  Account (self-service)
 *   PATCH /api/account/profile                  ProfileUpdate -> Me
 *   POST  /api/account/password                 PasswordChange -> { ok }
 *
 *  Admin (requires Me.isAdmin)
 *   GET    /api/admin/domains                   -> Domain[]
 *   POST   /api/admin/domains                   DomainCreate -> Domain
 *   GET    /api/admin/domains/:id               -> DomainDetail
 *   PATCH  /api/admin/domains/:id               DomainUpdate -> Domain
 *   DELETE /api/admin/domains/:id               -> { ok }
 *   GET    /api/admin/domains/:id/dns           -> DnsCheckResult            (cached; ?refresh=1 re-checks)
 *   GET    /api/admin/domains/:id/mailboxes     -> Mailbox[]
 *   POST   /api/admin/domains/:id/mailboxes     MailboxCreate -> Mailbox
 *   PATCH  /api/admin/mailboxes/:id             MailboxUpdate -> Mailbox
 *   DELETE /api/admin/mailboxes/:id             -> { ok }
 *   POST   /api/admin/mailboxes/:id/recalculate-quota        -> Mailbox   (recounts stored size via doveadm)
 *   GET    /api/admin/domains/:id/aliases       -> Alias[]
 *   POST   /api/admin/domains/:id/aliases       AliasCreate -> Alias
 *   PATCH  /api/admin/aliases/:id               AliasUpdate -> Alias
 *   DELETE /api/admin/aliases/:id               -> { ok }
 *   GET    /api/admin/status                    -> ServerStatus
 *   GET    /api/admin/lockouts                  -> Lockout[]
 *   DELETE /api/admin/lockouts/:key             -> { ok }
 *   GET    /api/admin/overview?range=&tz=       -> Overview                  (range 24h|7d|30d, tz = IANA zone for day buckets)
 *   GET    /api/admin/auth-events?result=&source=&q=&before=   -> Page<AuthEvent>
 *   GET    /api/admin/auth-events/failed-ips?hours=            -> FailedIp[]
 *   GET    /api/admin/sessions                  -> WebSession[]
 *   DELETE /api/admin/sessions/:id              -> { ok }
 *   GET    /api/admin/mail-log?direction=&status=&q=&before=   -> Page<MailLogEntry>
 *   GET    /api/admin/queue                     -> QueueSnapshot
 *   POST   /api/admin/queue/flush               -> { ok }                    (retry every deferred message now)
 *   POST   /api/admin/queue/:queueId/:action    -> { ok }                    (action: QueueAction)
 *   GET    /api/admin/spam-history              -> SpamHistory               (rspamd's recent scans)
 *   GET    /api/admin/logs?source=&level=&q=&limit=&own=       -> LogView   (own=1 keeps the web app's own connections)
 *   GET    /api/admin/audit?q=&before=          -> Page<AuditEntry>
 *
 *  Mail (per logged-in mailbox)
 *   GET    /api/mail/folders                    -> Folder[]
 *   POST   /api/mail/folders                    FolderCreate -> Folder
 *   DELETE /api/mail/folders/:path              -> { ok }
 *   GET    /api/mail/threads?folder=&cursor=&limit=&q=   -> ThreadList
 *   GET    /api/mail/threads/:threadId?folder=  -> Thread
 *   GET    /api/mail/messages/:folder/:uid      -> Message
 *   GET    /api/mail/messages/:folder/:uid/raw  -> message/rfc822 (download)
 *   GET    /api/mail/messages/:folder/:uid/attachments/:partId  -> binary (Content-Disposition from attachment)
 *   POST   /api/mail/messages/flags             FlagRequest -> { ok }
 *   POST   /api/mail/messages/move              MoveRequest -> { ok }
 *   POST   /api/mail/messages/delete            DeleteRequest -> { ok }     (moves to Trash, or expunges if already in Trash)
 *   POST   /api/mail/send                       multipart/form-data: "payload" (SendRequest JSON) + "files" -> { ok, messageId }
 *   PUT    /api/mail/drafts                     multipart/form-data: "payload" (DraftRequest JSON) + "files" -> { uid }
 *   GET    /api/mail/events                     text/event-stream: MailEvent
 *   GET    /api/mail/quota                      -> Quota
 *
 *  Contacts
 *   GET    /api/contacts?q=                     -> Contact[]
 *   POST   /api/contacts                        ContactCreate -> Contact
 *   PATCH  /api/contacts/:id                    ContactUpdate -> Contact
 *   DELETE /api/contacts/:id                    -> { ok }
 *   GET    /api/contacts/suggest?q=             -> AddressSuggestion[]
 *
 *  Internal (no auth, only reachable from the compose network / Caddy)
 *   GET    /internal/tls-allowed?domain=        200 if domain is mta-sts.<d> or autoconfig.<d> of a registered domain
 *   GET    /healthz                             200
 *
 *  Internal port (INTERNAL_PORT, 3001; never proxied by Caddy)
 *   POST   /dovecot/events/:token               Dovecot event exporter (auth_request_finished) -> 204
 *
 *  Served by Host header for registered domains (not under /api):
 *   GET    /.well-known/mta-sts.txt             (host mta-sts.<domain>)
 *   GET    /mail/config-v1.1.xml                (host autoconfig.<domain>)
 *   GET    /.well-known/autoconfig/mail/config-v1.1.xml
 */
import { z } from "zod";

export const APP_NAME = "Ionnet Mailer";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof OkSchema>;

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const DomainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Enter a valid domain name");

export const LocalPartSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/, "Use letters, numbers, dots, hyphens, underscores");

export const PasswordSchema = z.string().min(10, "At least 10 characters").max(72);

// ---------------------------------------------------------------------------
// Auth / account
// ---------------------------------------------------------------------------
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(72),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  domain: z.string(),
  isAdmin: z.boolean(),
  signature: z.string().nullable(),
  quotaBytes: z.number(),
  /** addresses this user may send from: their own first, then aliases that deliver to them */
  sendAs: z.array(z.string()).default([]),
});
export type Me = z.infer<typeof MeSchema>;

export const ProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  signature: z.string().max(5000).nullable().optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: PasswordSchema,
});
export type PasswordChange = z.infer<typeof PasswordChangeSchema>;

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------
export const SetupStatusSchema = z.object({
  completed: z.boolean(),
  hostname: z.string(),
  publicIp: z.string().nullable(),
  version: z.string(),
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

export const SetupHostnameCheckRequestSchema = z.object({ hostname: DomainNameSchema });
export type SetupHostnameCheckRequest = z.infer<typeof SetupHostnameCheckRequestSchema>;

export const SetupHostnameCheckResultSchema = z.object({
  hostname: z.string(),
  publicIp: z.string().nullable(),
  aRecords: z.array(z.string()),
  aMatches: z.boolean(),
  ptr: z.array(z.string()),
  ptrMatches: z.boolean(),
  warnings: z.array(z.string()),
});
export type SetupHostnameCheckResult = z.infer<typeof SetupHostnameCheckResultSchema>;

export const SetupCreateRequestSchema = z.object({
  hostname: DomainNameSchema,
  domain: DomainNameSchema,
  adminLocalPart: LocalPartSchema,
  adminDisplayName: z.string().trim().min(1).max(120),
  adminPassword: PasswordSchema,
});
export type SetupCreateRequest = z.infer<typeof SetupCreateRequestSchema>;

// ---------------------------------------------------------------------------
// Admin: domains, mailboxes, aliases
// ---------------------------------------------------------------------------
export const DomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  dkimSelector: z.string(),
  dkimPublicKey: z.string(),
  catchAll: z.string().nullable(), // destination of the "@domain" alias, if any
  mailboxCount: z.number(),
  aliasCount: z.number(),
  createdAt: z.string(),
});
export type Domain = z.infer<typeof DomainSchema>;

export const DomainCreateSchema = z.object({ name: DomainNameSchema });
export type DomainCreate = z.infer<typeof DomainCreateSchema>;

export const DomainUpdateSchema = z.object({
  active: z.boolean().optional(),
  catchAll: EmailSchema.nullable().optional(),
});
export type DomainUpdate = z.infer<typeof DomainUpdateSchema>;

export const MailboxSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  localPart: z.string(),
  email: z.string(),
  displayName: z.string(),
  quotaBytes: z.number(),
  usedBytes: z.number().nullable(),
  isAdmin: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type Mailbox = z.infer<typeof MailboxSchema>;

export const MailboxCreateSchema = z.object({
  localPart: LocalPartSchema,
  displayName: z.string().trim().min(1).max(120),
  password: PasswordSchema,
  quotaBytes: z.number().int().min(0).default(0), // 0 = unlimited
  isAdmin: z.boolean().default(false),
});
export type MailboxCreate = z.infer<typeof MailboxCreateSchema>;

export const MailboxUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  password: PasswordSchema.optional(),
  quotaBytes: z.number().int().min(0).optional(),
  isAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type MailboxUpdate = z.infer<typeof MailboxUpdateSchema>;

export const AliasSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  source: z.string(), // "name@domain" or "@domain" for catch-all
  destination: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type Alias = z.infer<typeof AliasSchema>;

export const AliasCreateSchema = z.object({
  localPart: LocalPartSchema.or(z.literal("")), // "" = catch-all
  destination: EmailSchema,
});
export type AliasCreate = z.infer<typeof AliasCreateSchema>;

export const AliasUpdateSchema = z.object({
  destination: EmailSchema.optional(),
  active: z.boolean().optional(),
});
export type AliasUpdate = z.infer<typeof AliasUpdateSchema>;

export const DomainDetailSchema = DomainSchema.extend({
  mailboxes: z.array(MailboxSchema),
  aliases: z.array(AliasSchema),
});
export type DomainDetail = z.infer<typeof DomainDetailSchema>;

// ---------------------------------------------------------------------------
// DNS guide
// ---------------------------------------------------------------------------
export const DnsRecordTypeSchema = z.enum(["MX", "A", "AAAA", "TXT", "SRV", "CNAME", "PTR"]);
export const DnsRecordStatusSchema = z.enum(["ok", "missing", "mismatch", "unknown"]);

export const DnsRecordSchema = z.object({
  key: z.string(), // stable id, e.g. "mx", "spf", "dkim", "dmarc", "mta-sts-txt", ...
  group: z.enum(["required", "recommended", "optional"]),
  title: z.string(),
  description: z.string(),
  type: DnsRecordTypeSchema,
  name: z.string(), // fully-qualified record name
  value: z.string(), // exact value to publish
  priority: z.number().optional(),
  ttl: z.number().optional(),
  status: DnsRecordStatusSchema,
  found: z.array(z.string()),
  hint: z.string().optional(),
});
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export const DnsCheckResultSchema = z.object({
  domain: z.string(),
  hostname: z.string(),
  checkedAt: z.string(),
  allRequiredOk: z.boolean(),
  records: z.array(DnsRecordSchema),
});
export type DnsCheckResult = z.infer<typeof DnsCheckResultSchema>;

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------
export const ServiceCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});
export const ServerStatusSchema = z.object({
  hostname: z.string(),
  publicIp: z.string().nullable(),
  ptr: z.array(z.string()),
  version: z.string(),
  certificate: z.object({
    subject: z.string(),
    issuer: z.string(),
    validFrom: z.string(),
    validTo: z.string(),
    daysLeft: z.number(),
    selfSigned: z.boolean(),
  }).nullable(),
  services: z.array(ServiceCheckSchema),
  rspamd: z.object({
    scanned: z.number(),
    spam: z.number(),
    ham: z.number(),
    learned: z.number(),
  }).nullable(),
  counts: z.object({ domains: z.number(), mailboxes: z.number(), aliases: z.number() }),
  clamavEnabled: z.boolean(),
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const LockoutSchema = z.object({
  key: z.string(), // "ip:1.2.3.4" or "user:foo@bar"
  attempts: z.number(),
  lockedUntil: z.string().nullable(),
});
export type Lockout = z.infer<typeof LockoutSchema>;

// ---------------------------------------------------------------------------
// Admin: activity & monitoring
// ---------------------------------------------------------------------------
/** Paged lists return the newest rows first; pass `nextCursor` back as `?before=` for the next page. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Where a sign-in attempt came from: the web app, or a mail protocol authenticated by Dovecot. */
export const AuthSourceSchema = z.enum(["web", "imap", "pop3", "smtp", "sieve", "other"]);
export type AuthSource = z.infer<typeof AuthSourceSchema>;

export const AuthFailureReasonSchema = z.enum(["wrong_password", "unknown_user", "disabled", "locked"]);
export type AuthFailureReason = z.infer<typeof AuthFailureReasonSchema>;

/** Identical attempts close together are folded into one row; `count` says how many. */
export const AuthEventSchema = z.object({
  id: z.string(),
  source: AuthSourceSchema,
  username: z.string().nullable(),
  mailboxId: z.string().nullable(),
  ip: z.string().nullable(),
  success: z.boolean(),
  reason: AuthFailureReasonSchema.nullable(),
  detail: z.string().nullable(), // e.g. "PLAIN, TLS"
  userAgent: z.string().nullable(),
  count: z.number(),
  firstAt: z.string(),
  lastAt: z.string(),
});
export type AuthEvent = z.infer<typeof AuthEventSchema>;

export const FailedIpSchema = z.object({
  ip: z.string(),
  failures: z.number(),
  usernames: z.array(z.string()), // a few of the names tried
  sources: z.array(AuthSourceSchema),
  lastAt: z.string(),
});
export type FailedIp = z.infer<typeof FailedIpSchema>;

export const MailDirectionSchema = z.enum(["in", "out"]);
export type MailDirection = z.infer<typeof MailDirectionSchema>;

/** delivered = stored in a local mailbox, sent = accepted by the remote server, deleted = removed from the queue by an admin. */
export const MailLogStatusSchema = z.enum(["delivered", "sent", "deferred", "bounced", "expired", "rejected", "deleted"]);
export type MailLogStatus = z.infer<typeof MailLogStatusSchema>;

/** One recipient of one message as seen by Postfix, or a rejected delivery attempt. */
export const MailLogEntrySchema = z.object({
  id: z.string(),
  queueId: z.string().nullable(),
  messageId: z.string().nullable(),
  direction: MailDirectionSchema,
  status: MailLogStatusSchema,
  sender: z.string(), // "" for the null sender (bounces)
  recipient: z.string(),
  origRecipient: z.string().nullable(), // the address before alias expansion
  subject: z.string().nullable(),
  size: z.number().nullable(),
  clientHost: z.string().nullable(),
  clientIp: z.string().nullable(),
  source: z.string().nullable(), // smtp | submission | smtps | app | local
  saslUser: z.string().nullable(),
  relay: z.string().nullable(),
  dsn: z.string().nullable(),
  detail: z.string().nullable(), // remote server reply or reject reason
  attempts: z.number(),
  firstAt: z.string(),
  lastAt: z.string(),
});
export type MailLogEntry = z.infer<typeof MailLogEntrySchema>;

export const QueueMessageSchema = z.object({
  queueId: z.string(),
  queue: z.string(), // active | deferred | hold | incoming | maildrop
  arrivalTime: z.string(),
  size: z.number(),
  sender: z.string(),
  recipients: z.array(z.object({ address: z.string(), reason: z.string().nullable() })),
});
export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const QueueSnapshotSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable(),
  messages: z.array(QueueMessageSchema),
});
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;

export const QueueActionSchema = z.enum(["retry", "hold", "release", "delete"]);
export type QueueAction = z.infer<typeof QueueActionSchema>;

export const SpamScanSchema = z.object({
  id: z.string(),
  time: z.string(),
  ip: z.string().nullable(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  action: z.string(), // rspamd action: "no action", "add header", "greylist", "reject", ...
  score: z.number(),
  requiredScore: z.number(),
  size: z.number(),
  user: z.string().nullable(), // authenticated sender, if any
  symbols: z.array(z.object({ name: z.string(), score: z.number(), description: z.string().nullable(), options: z.array(z.string()) })),
});
export type SpamScan = z.infer<typeof SpamScanSchema>;

export const SpamHistorySchema = z.object({ available: z.boolean(), scans: z.array(SpamScanSchema) });
export type SpamHistory = z.infer<typeof SpamHistorySchema>;

export const LogSourceSchema = z.enum(["postfix", "dovecot", "app"]);
export type LogSource = z.infer<typeof LogSourceSchema>;
export const LogLevelSchema = z.enum(["info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogViewSchema = z.object({
  source: LogSourceSchema,
  available: z.boolean(),
  note: z.string().nullable(),
  lines: z.array(z.object({ time: z.string().nullable(), level: LogLevelSchema, text: z.string() })),
});
export type LogView = z.infer<typeof LogViewSchema>;

export const WebSessionSchema = z.object({
  id: z.string(), // an opaque handle, never the session token itself
  mailboxId: z.string(),
  email: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
});
export type WebSession = z.infer<typeof WebSessionSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actorEmail: z.string().nullable(),
  ip: z.string().nullable(),
  action: z.string(), // "mailbox.create", "queue.delete", ...
  target: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const OverviewRangeSchema = z.enum(["24h", "7d", "30d"]);
export type OverviewRange = z.infer<typeof OverviewRangeSchema>;

export const OverviewAlertSchema = z.object({
  level: z.enum(["danger", "warning", "info"]),
  title: z.string(),
  detail: z.string(),
  /** in-app page that helps, e.g. "/admin/mail?tab=queue" */
  href: z.string().nullable(),
});
export type OverviewAlert = z.infer<typeof OverviewAlertSchema>;

export const OverviewSchema = z.object({
  generatedAt: z.string(),
  range: OverviewRangeSchema,
  /** bucket size of the series: an hour for 24h, a day otherwise */
  bucket: z.enum(["hour", "day"]),
  health: z.object({
    servicesOk: z.number(),
    servicesTotal: z.number(),
    down: z.array(z.string()),
    certDaysLeft: z.number().nullable(),
    certSelfSigned: z.boolean(),
  }),
  host: z.object({
    diskTotalBytes: z.number().nullable(),
    diskFreeBytes: z.number().nullable(),
    memTotalBytes: z.number(),
    memAvailableBytes: z.number(),
    load: z.array(z.number()), // 1, 5, 15 minutes
    cpus: z.number(),
    uptimeSeconds: z.number(),
  }),
  mail: z.object({
    received: z.number(),
    sent: z.number(),
    rejected: z.number(),
    bounced: z.number(),
    deferred: z.number(),
    series: z.array(z.object({ t: z.string(), received: z.number(), sent: z.number(), rejected: z.number(), bounced: z.number() })),
  }),
  logins: z.object({
    failed: z.number(),
    succeeded: z.number(),
    series: z.array(z.object({ t: z.string(), failed: z.number(), succeeded: z.number() })),
    topFailedIps: z.array(FailedIpSchema),
  }),
  queue: z.object({ total: z.number(), deferred: z.number(), hold: z.number(), oldest: z.string().nullable() }).nullable(),
  storage: z.array(z.object({ email: z.string(), usedBytes: z.number(), quotaBytes: z.number() })),
  counts: z.object({ domains: z.number(), mailboxes: z.number(), aliases: z.number(), sessions: z.number(), lockouts: z.number() }),
  alerts: z.array(OverviewAlertSchema),
  recentAudit: z.array(AuditEntrySchema),
});
export type Overview = z.infer<typeof OverviewSchema>;

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------
export const SpecialUseSchema = z.enum(["inbox", "drafts", "sent", "junk", "trash", "archive"]);
export type SpecialUse = z.infer<typeof SpecialUseSchema>;

export const FolderSchema = z.object({
  path: z.string(), // IMAP path, e.g. "INBOX", "Projects/2026"
  name: z.string(), // last path segment
  delimiter: z.string(),
  specialUse: SpecialUseSchema.nullable(),
  unread: z.number(),
  total: z.number(),
  subscribed: z.boolean(),
});
export type Folder = z.infer<typeof FolderSchema>;

export const FolderCreateSchema = z.object({
  path: z.string().trim().min(1).max(200),
});
export type FolderCreate = z.infer<typeof FolderCreateSchema>;

export const AddressSchema = z.object({
  name: z.string(),
  address: z.string(),
});
export type Address = z.infer<typeof AddressSchema>;

export const MessageRefSchema = z.object({
  folder: z.string(),
  uid: z.number().int(),
});
export type MessageRef = z.infer<typeof MessageRefSchema>;

export const ThreadSummarySchema = z.object({
  id: z.string(), // stable thread id (root Message-ID hash)
  folder: z.string(),
  subject: z.string(),
  participants: z.array(AddressSchema), // deduplicated senders/recipients, newest first
  snippet: z.string(),
  date: z.string(), // ISO of newest message
  unread: z.boolean(),
  flagged: z.boolean(),
  answered: z.boolean(),
  hasAttachments: z.boolean(),
  messageCount: z.number(),
  uids: z.array(z.number()), // UIDs in this folder, oldest first
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ThreadListSchema = z.object({
  folder: z.string(),
  threads: z.array(ThreadSummarySchema),
  nextCursor: z.string().nullable(),
  total: z.number(),
});
export type ThreadList = z.infer<typeof ThreadListSchema>;

export const AttachmentSchema = z.object({
  partId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  contentId: z.string().nullable(),
  inline: z.boolean(),
  url: z.string(), // /api/mail/messages/:folder/:uid/attachments/:partId
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const MessageHeaderSchema = z.object({
  uid: z.number(),
  folder: z.string(),
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  from: AddressSchema.nullable(),
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  bcc: z.array(AddressSchema),
  replyTo: z.array(AddressSchema),
  subject: z.string(),
  date: z.string(),
  flags: z.array(z.string()), // raw IMAP flags: \Seen \Flagged \Answered \Draft $Forwarded
  unread: z.boolean(),
  flagged: z.boolean(),
  answered: z.boolean(),
  draft: z.boolean(),
  size: z.number(),
  hasAttachments: z.boolean(),
  snippet: z.string(),
});
export type MessageHeader = z.infer<typeof MessageHeaderSchema>;

export const MessageSchema = MessageHeaderSchema.extend({
  html: z.string().nullable(), // raw HTML with cid: rewritten to attachment URLs; client sanitizes
  text: z.string().nullable(),
  attachments: z.array(AttachmentSchema),
  hasRemoteContent: z.boolean(),
  listUnsubscribe: z.string().nullable(),
  authentication: z.object({
    spf: z.string().nullable(),
    dkim: z.string().nullable(),
    dmarc: z.string().nullable(),
    spamScore: z.number().nullable(),
  }),
});
export type Message = z.infer<typeof MessageSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  messages: z.array(MessageSchema), // oldest first
});
export type Thread = z.infer<typeof ThreadSchema>;

export const FlagRequestSchema = z.object({
  messages: z.array(MessageRefSchema).min(1),
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
});
export type FlagRequest = z.infer<typeof FlagRequestSchema>;

export const MoveRequestSchema = z.object({
  messages: z.array(MessageRefSchema).min(1),
  destination: z.string(),
});
export type MoveRequest = z.infer<typeof MoveRequestSchema>;

export const DeleteRequestSchema = z.object({
  messages: z.array(MessageRefSchema).min(1),
  permanent: z.boolean().default(false),
});
export type DeleteRequest = z.infer<typeof DeleteRequestSchema>;

export const RecipientSchema = z.object({
  name: z.string().max(200).default(""),
  address: EmailSchema,
});

export const SendRequestSchema = z.object({
  to: z.array(RecipientSchema).min(1),
  cc: z.array(RecipientSchema).default([]),
  bcc: z.array(RecipientSchema).default([]),
  subject: z.string().max(998).default(""),
  html: z.string().max(5_000_000).default(""),
  text: z.string().max(5_000_000).optional(),
  fromName: z.string().max(200).optional(),
  fromAddress: EmailSchema.optional(), // must be the user's own address or one of their aliases
  inReplyTo: MessageRefSchema.nullable().default(null),
  replyMode: z.enum(["reply", "forward"]).nullable().default(null),
  draftUid: z.number().int().nullable().default(null), // draft to delete after successful send
  // Attachments carried over from an existing message (e.g. forwarding)
  forwardAttachments: z.array(z.object({ ref: MessageRefSchema, partId: z.string() })).default([]),
  requestReadReceipt: z.boolean().default(false),
});
export type SendRequest = z.infer<typeof SendRequestSchema>;

export const DraftRequestSchema = SendRequestSchema.partial({ to: true }).extend({
  to: z.array(RecipientSchema).default([]),
  draftUid: z.number().int().nullable().default(null), // existing draft to replace
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

export const QuotaSchema = z.object({
  usedBytes: z.number(),
  limitBytes: z.number(), // 0 = unlimited
});
export type Quota = z.infer<typeof QuotaSchema>;

export const MailEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("new"), folder: z.string(), uid: z.number(), from: AddressSchema.nullable(), subject: z.string() }),
  z.object({ type: z.literal("expunge"), folder: z.string(), uid: z.number() }),
  z.object({ type: z.literal("flags"), folder: z.string(), uid: z.number(), flags: z.array(z.string()) }),
  z.object({ type: z.literal("folders") }),
  z.object({ type: z.literal("ping") }),
]);
export type MailEvent = z.infer<typeof MailEventSchema>;

// The SSE stream names every frame after its `type`, and EventSource only routes
// unnamed frames to `onmessage`, so the client has to subscribe to each name.
// `satisfies` keeps this exhaustive as the union above grows.
const MAIL_EVENT_TYPE_KEYS = {
  new: true,
  expunge: true,
  flags: true,
  folders: true,
  ping: true,
} as const satisfies Record<MailEvent["type"], true>;
export const MAIL_EVENT_TYPES = Object.keys(MAIL_EVENT_TYPE_KEYS) as Array<MailEvent["type"]>;

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  notes: z.string(),
  source: z.enum(["manual", "auto"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  emails: z.array(EmailSchema).min(1).max(10),
  notes: z.string().max(5000).default(""),
});
export type ContactCreate = z.infer<typeof ContactCreateSchema>;

export const ContactUpdateSchema = ContactCreateSchema.partial();
export type ContactUpdate = z.infer<typeof ContactUpdateSchema>;

export const AddressSuggestionSchema = z.object({
  name: z.string(),
  address: z.string(),
  source: z.enum(["contact", "recent", "mailbox"]),
});
export type AddressSuggestion = z.infer<typeof AddressSuggestionSchema>;

// ---------------------------------------------------------------------------
// Helpers shared by both sides
// ---------------------------------------------------------------------------
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function specialUseFromFlag(flag: string | undefined | null): SpecialUse | null {
  switch ((flag ?? "").toLowerCase()) {
    case "\\inbox":
      return "inbox";
    case "\\drafts":
      return "drafts";
    case "\\sent":
      return "sent";
    case "\\junk":
      return "junk";
    case "\\trash":
      return "trash";
    case "\\archive":
      return "archive";
    default:
      return null;
  }
}
