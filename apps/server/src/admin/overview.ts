import os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { Op, QueryTypes } from "sequelize";
import type { DnsCheckResult, Overview, OverviewAlert, OverviewRange } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { config } from "../config.ts";
import { sequelize } from "../db/sequelize.ts";
import { AliasRow, AuditRow, DnsCheckRow, Domain, MailboxRow, Session } from "../db/models.ts";
import { cachedServerStatus } from "../status/status.ts";
import { listLockouts } from "../auth/ratelimit.ts";
import { getMailboxUsages } from "../mail/usage.ts";
import { quotaUsageAll } from "../mail/doveadm.ts";
import { failedIps } from "../activity/auth-events.ts";
import { toAuditDto } from "../activity/audit.ts";
import { queueSnapshot } from "../activity/postfix-ctl.ts";
import { logger } from "../logger.ts";

const log = logger("overview");

const RANGES: Record<OverviewRange, { unit: "hour" | "day"; span: string; step: string; hours: number }> = {
  "24h": { unit: "hour", span: "23 hours", step: "1 hour", hours: 24 },
  "7d": { unit: "day", span: "6 days", step: "1 day", hours: 7 * 24 },
  "30d": { unit: "day", span: "29 days", step: "1 day", hours: 30 * 24 },
};

/** Falls back to UTC for anything that isn't a zone name both Node and Postgres understand. */
function safeZone(tz: string | undefined): string {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

interface MailBucket {
  t: Date;
  received: number;
  sent: number;
  rejected: number;
  bounced: number;
}
interface LoginBucket {
  t: Date;
  failed: number;
  succeeded: number;
}

async function series(range: OverviewRange, tz: string) {
  const r = RANGES[range];
  const replacements = { unit: r.unit, span: r.span, step: r.step, tz };
  const buckets = await sequelize.query<{ t: Date }>(
    `SELECT generate_series(date_trunc(:unit, now() - CAST(:span AS interval), :tz), now(), CAST(:step AS interval), :tz) AS t`,
    { replacements, type: QueryTypes.SELECT },
  );
  const from = buckets[0]?.t ?? new Date(Date.now() - r.hours * 3600_000);
  const [mail, logins] = await Promise.all([
    sequelize.query<MailBucket>(
      `SELECT date_trunc(:unit, created_at, :tz) AS t,
              count(*) FILTER (WHERE direction = 'in' AND status = 'delivered')::int AS received,
              count(*) FILTER (WHERE direction = 'out' AND status = 'sent')::int AS sent,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              count(*) FILTER (WHERE status IN ('bounced', 'expired'))::int AS bounced
         FROM mail_log WHERE created_at >= :from GROUP BY 1`,
      { replacements: { ...replacements, from }, type: QueryTypes.SELECT },
    ),
    sequelize.query<LoginBucket>(
      `SELECT date_trunc(:unit, created_at, :tz) AS t,
              coalesce(sum(count) FILTER (WHERE NOT success), 0)::int AS failed,
              coalesce(sum(count) FILTER (WHERE success), 0)::int AS succeeded
         FROM auth_events WHERE created_at >= :from GROUP BY 1`,
      { replacements: { ...replacements, from }, type: QueryTypes.SELECT },
    ),
  ]);
  const mailBy = new Map(mail.map((m) => [new Date(m.t).getTime(), m]));
  const loginBy = new Map(logins.map((l) => [new Date(l.t).getTime(), l]));
  const deferred = await sequelize.query<{ n: number }>(`SELECT count(*)::int AS n FROM mail_log WHERE status = 'deferred' AND created_at >= :from`, {
    replacements: { from },
    type: QueryTypes.SELECT,
  });
  return {
    unit: r.unit,
    hours: r.hours,
    deferred: deferred[0]?.n ?? 0,
    mail: buckets.map(({ t }) => {
      const m = mailBy.get(new Date(t).getTime());
      return { t: new Date(t).toISOString(), received: m?.received ?? 0, sent: m?.sent ?? 0, rejected: m?.rejected ?? 0, bounced: m?.bounced ?? 0 };
    }),
    logins: buckets.map(({ t }) => {
      const l = loginBy.get(new Date(t).getTime());
      return { t: new Date(t).toISOString(), failed: l?.failed ?? 0, succeeded: l?.succeeded ?? 0 };
    }),
  };
}

async function hostMetrics(): Promise<Overview["host"]> {
  let diskTotalBytes: number | null = null;
  let diskFreeBytes: number | null = null;
  // Docker volumes live on the same filesystem as the logs volume (or the container root).
  for (const p of [config.LOGS_DIR, "/"]) {
    try {
      const s = await statfs(p);
      diskTotalBytes = s.blocks * s.bsize;
      diskFreeBytes = s.bavail * s.bsize;
      break;
    } catch {
      // try the next path
    }
  }
  let memAvailableBytes = os.freemem();
  try {
    const m = /^MemAvailable:\s+(\d+) kB/m.exec(await readFile("/proc/meminfo", "utf8"));
    if (m) memAvailableBytes = Number(m[1]) * 1024;
  } catch {
    // not Linux
  }
  return {
    diskTotalBytes,
    diskFreeBytes,
    memTotalBytes: os.totalmem(),
    memAvailableBytes,
    load: os.loadavg().map((n) => Math.round(n * 100) / 100),
    cpus: os.cpus().length,
    uptimeSeconds: Math.round(os.uptime()),
  };
}

// ---- mailbox storage (one IMAP QUOTA call per mailbox, so it is cached) --------
type Usage = Overview["storage"][number] & { domainId: string };
let usageCache: { at: number; rows: Usage[] } | null = null;
let usageRefresh: Promise<Usage[]> | null = null;
const USAGE_TTL_MS = 10 * 60_000;

async function computeUsage(): Promise<Usage[]> {
  const mailboxes = await MailboxRow.findAll({ where: { active: true }, order: [["email", "ASC"]] });
  // One doveadm call for every mailbox; per-mailbox lookups (IMAP fallback) if that fails.
  const used = await quotaUsageAll()
    .then((all) => new Map(mailboxes.map((m) => [m.id, all.get(m.email)?.usedBytes ?? null])))
    .catch(() => getMailboxUsages(mailboxes.slice(0, 200)));
  return mailboxes
    .flatMap((m) => {
      const u = used.get(m.id);
      return u == null ? [] : [{ email: m.email, usedBytes: u, quotaBytes: Number(m.quotaBytes), domainId: m.domainId }];
    })
    .sort((a, b) => b.usedBytes - a.usedBytes);
}

async function mailboxUsage(): Promise<Usage[]> {
  const fresh = usageCache && Date.now() - usageCache.at < USAGE_TTL_MS;
  if (!fresh && !usageRefresh) {
    usageRefresh = computeUsage()
      .then((rows) => {
        usageCache = { at: Date.now(), rows };
        return rows;
      })
      .catch((err) => {
        log.warn(`mailbox usage failed: ${(err as Error).message}`);
        return usageCache?.rows ?? [];
      })
      .finally(() => {
        usageRefresh = null;
      });
  }
  if (usageCache) return usageCache.rows; // stale is fine while it refreshes
  // First call: wait a little, but never hold the whole overview hostage.
  return Promise.race([usageRefresh ?? Promise.resolve([]), new Promise<Usage[]>((r) => setTimeout(() => r([]), 4000))]);
}

// ---- alerts ----------------------------------------------------------------------
function ago(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export async function buildOverview(range: OverviewRange, tzParam: string | undefined): Promise<Overview> {
  const tz = safeZone(tzParam);
  const statusP = cachedServerStatus().catch(() => null);
  // Postgres may not know every zone Node does.
  const seriesP = series(range, tz).catch((err) => {
    log.warn(`series in ${tz} failed, using UTC: ${(err as Error).message}`);
    return series(range, "UTC");
  });
  // Alerts describe the present, so they always look at the last 24 hours whatever the chart range.
  const bounced24hP = sequelize.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mail_log WHERE status IN ('bounced', 'expired') AND updated_at > now() - interval '24 hours'`,
    { type: QueryTypes.SELECT },
  );
  const [status, s, host, queue, usage, topIps, ips24h, bounced24h, lockouts, counts, recentAudit, dnsRows, domains] = await Promise.all([
    statusP,
    seriesP,
    hostMetrics(),
    queueSnapshot(5000, 3000),
    mailboxUsage(),
    failedIps(RANGES[range].hours, 5),
    range === "24h" ? null : failedIps(24, 5),
    bounced24hP,
    listLockouts().catch(() => []),
    Promise.all([Domain.count(), MailboxRow.count(), AliasRow.count({ where: { source: { [Op.notLike]: "@%" } } }), Session.count({ where: { expiresAt: { [Op.gt]: new Date() } } })]),
    AuditRow.findAll({ order: [["id", "DESC"]], limit: 6 }),
    DnsCheckRow.findAll(),
    Domain.findAll({ attributes: ["id", "name", "active"] }),
  ]);

  const sum = <T>(rows: T[], k: keyof T) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const alerts: OverviewAlert[] = [];

  // Services and certificate
  if (status) {
    for (const svc of status.services.filter((x) => !x.ok)) {
      alerts.push({ level: "danger", title: `${svc.name} is not responding`, detail: svc.detail, href: "/admin/status" });
    }
    const cert = status.certificate;
    if (!cert) alerts.push({ level: "warning", title: "TLS certificate could not be read", detail: "Dovecot did not present a certificate on port 993.", href: "/admin/status" });
    else if (cert.selfSigned) alerts.push({ level: "warning", title: "Self-signed certificate in use", detail: "Mail clients will warn until a Let's Encrypt certificate is issued.", href: "/admin/status" });
    else if (cert.daysLeft < 0) alerts.push({ level: "danger", title: `TLS certificate expired ${-cert.daysLeft} days ago`, detail: "Mail clients refuse to connect. Check that ports 80/443 are reachable so Caddy can renew it.", href: "/admin/status" });
    else if (cert.daysLeft < 7) alerts.push({ level: "danger", title: `TLS certificate expires in ${cert.daysLeft} days`, detail: "Caddy should have renewed it by now; check that ports 80/443 are reachable.", href: "/admin/status" });
    else if (cert.daysLeft < 21) alerts.push({ level: "warning", title: `TLS certificate expires in ${cert.daysLeft} days`, detail: "Caddy renews automatically about 30 days before expiry.", href: "/admin/status" });
    if (status.publicIp && !status.ptr.includes(status.hostname)) {
      alerts.push({
        level: "warning",
        title: "Reverse DNS does not match the hostname",
        detail: `${status.publicIp} points to ${status.ptr.join(", ") || "nothing"}, not ${status.hostname}. Many providers reject mail from servers without it.`,
        href: "/admin/status",
      });
    }
  }

  // DNS, from the cached checks (the overview never triggers lookups itself)
  const domainName = new Map(domains.map((d) => [d.id, d]));
  for (const row of dnsRows) {
    const d = domainName.get(row.domainId);
    const result = row.result as DnsCheckResult;
    if (d?.active && !result.allRequiredOk) {
      const bad = result.records.filter((r) => r.group === "required" && r.status !== "ok").map((r) => r.title);
      alerts.push({ level: "warning", title: `DNS records for ${d.name} need attention`, detail: bad.join(", ") || "Some required records are missing.", href: `/admin/domains/${d.id}?tab=dns` });
    }
  }

  // Queue
  const deferred = queue.messages.filter((m) => m.queue === "deferred");
  const held = queue.messages.filter((m) => m.queue === "hold");
  if (deferred.length) {
    alerts.push({
      level: deferred.length > 20 ? "danger" : "warning",
      title: `${deferred.length} ${deferred.length === 1 ? "message is" : "messages are"} waiting to be retried`,
      detail: `The oldest has been in the queue for ${ago(deferred[0]!.arrivalTime)}. ${deferred[0]!.recipients[0]?.reason ?? ""}`.trim(),
      href: "/admin/mail?tab=queue",
    });
  }
  if (held.length) alerts.push({ level: "info", title: `${held.length} held ${held.length === 1 ? "message" : "messages"} in the queue`, detail: "Held mail is not delivered until you release it.", href: "/admin/mail?tab=queue" });
  if (!queue.available) alerts.push({ level: "info", title: "Mail queue is not available", detail: queue.error ?? "", href: "/admin/mail?tab=queue" });

  // Delivery problems
  const bouncedToday = bounced24h[0]?.n ?? 0;
  if (bouncedToday) {
    alerts.push({
      level: "info",
      title: `${bouncedToday} ${bouncedToday === 1 ? "message" : "messages"} bounced in the last 24 hours`,
      detail: "The receiving server refused them permanently, or they expired in the queue.",
      href: "/admin/mail?tab=log&status=problems",
    });
  }

  // Password guessing: one alert for every address with many failures today
  const guessers = (ips24h ?? topIps).filter((x) => x.failures >= 20);
  if (guessers.length) {
    const one = guessers.length === 1 ? guessers[0]! : null;
    alerts.push({
      level: "warning",
      title: one ? `${one.failures} failed sign-ins from ${one.ip} in the last 24 hours` : `Password guessing from ${guessers.length} addresses in the last 24 hours`,
      detail: one
        ? `Tried ${one.usernames.slice(0, 3).join(", ") || "unknown accounts"} via ${one.sources.join(", ")}.`
        : guessers.map((g) => `${g.ip} (${g.failures})`).join(", "),
      href: one ? `/admin/security?tab=signins&q=${encodeURIComponent(one.ip)}` : "/admin/security?tab=signins&result=failed",
    });
  }
  if (lockouts.length) alerts.push({ level: "info", title: `${lockouts.length} web ${lockouts.length === 1 ? "lockout" : "lockouts"} active`, detail: "Too many failed web sign-ins; they expire on their own.", href: "/admin/security?tab=lockouts" });

  // Storage
  for (const u of usage.filter((x) => x.quotaBytes > 0 && x.usedBytes / x.quotaBytes >= 0.9).slice(0, 5)) {
    const pct = Math.round((u.usedBytes / u.quotaBytes) * 100);
    alerts.push({ level: pct >= 100 ? "danger" : "warning", title: `${u.email} is at ${pct}% of its quota`, detail: `${formatBytes(u.usedBytes)} of ${formatBytes(u.quotaBytes)}. New mail bounces once it is full.`, href: `/admin/domains/${u.domainId}` });
  }
  if (host.diskTotalBytes && host.diskFreeBytes !== null) {
    const free = host.diskFreeBytes / host.diskTotalBytes;
    if (free < 0.2) {
      alerts.push({
        level: free < 0.1 ? "danger" : "warning",
        title: `Disk is ${Math.round((1 - free) * 100)}% full`,
        detail: `${formatBytes(host.diskFreeBytes)} free of ${formatBytes(host.diskTotalBytes)}. Mail, logs and the database share this disk.`,
        href: null,
      });
    }
  }

  const order = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);

  return {
    generatedAt: new Date().toISOString(),
    range,
    bucket: s.unit,
    health: {
      servicesOk: status?.services.filter((x) => x.ok).length ?? 0,
      servicesTotal: status?.services.length ?? 0,
      down: status?.services.filter((x) => !x.ok).map((x) => x.name) ?? [],
      certDaysLeft: status?.certificate?.daysLeft ?? null,
      certSelfSigned: status?.certificate?.selfSigned ?? false,
    },
    host,
    mail: {
      received: sum(s.mail, "received"),
      sent: sum(s.mail, "sent"),
      rejected: sum(s.mail, "rejected"),
      bounced: sum(s.mail, "bounced"),
      deferred: s.deferred,
      series: s.mail,
    },
    logins: {
      failed: sum(s.logins, "failed"),
      succeeded: sum(s.logins, "succeeded"),
      series: s.logins,
      topFailedIps: topIps,
    },
    queue: queue.available
      ? { total: queue.messages.length, deferred: deferred.length, hold: held.length, oldest: queue.messages[0]?.arrivalTime ?? null }
      : null,
    storage: usage.slice(0, 5).map(({ email, usedBytes, quotaBytes }) => ({ email, usedBytes, quotaBytes })),
    counts: { domains: counts[0], mailboxes: counts[1], aliases: counts[2], sessions: counts[3], lockouts: lockouts.length },
    alerts,
    recentAudit: recentAudit.map(toAuditDto),
  };
}
