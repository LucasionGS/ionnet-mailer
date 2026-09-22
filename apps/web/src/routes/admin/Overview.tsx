import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, Clock, Inbox, Info, KeyRound, OctagonAlert, RefreshCw, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Overview, OverviewAlert, OverviewRange } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { useOverview } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button, ErrorState, PageSpinner } from "@/components/ui";
import { Card, Meter, Segmented, StatTile, formatCount, formatDuration, fullTime, timeAgo, useNow } from "@/features/admin/kit";
import { ChartLegend, ColumnChart, type ChartSeries } from "@/features/admin/ColumnChart";
import { describeAudit } from "@/features/admin/audit";
import { AdminHeader } from "./AdminLayout";

const RANGES: Array<{ value: OverviewRange; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];
const RANGE_TEXT: Record<OverviewRange, string> = { "24h": "in the last 24 hours", "7d": "in the last 7 days", "30d": "in the last 30 days" };

const MAIL_SERIES: ChartSeries<"received" | "sent" | "rejected">[] = [
  { key: "received", label: "Received", color: "var(--chart-1)" },
  { key: "sent", label: "Sent", color: "var(--chart-2)" },
  { key: "rejected", label: "Rejected", color: "var(--chart-3)" },
];
const LOGIN_SERIES: ChartSeries<"failed">[] = [{ key: "failed", label: "Failed sign-ins", color: "var(--chart-1)" }];

const ALERT_STYLE = {
  danger: { icon: OctagonAlert, className: "text-danger", label: "Critical" },
  warning: { icon: TriangleAlert, className: "text-warning", label: "Warning" },
  info: { icon: Info, className: "text-fg-muted", label: "Note" },
} as const;

function Alerts({ alerts }: { alerts: OverviewAlert[] }) {
  const navigate = useNavigate();
  if (!alerts.length) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-surface px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success">
          <CircleCheck size={16} />
        </span>
        <div>
          <div className="text-sm font-medium">Nothing needs your attention</div>
          <div className="text-xs text-fg-muted">Services are up, the queue is clear and no mailbox is close to full.</div>
        </div>
      </div>
    );
  }
  return (
    <Card title="Needs attention" bodyClassName="p-0" action={<span className="text-xs text-fg-muted">{alerts.length} {alerts.length === 1 ? "item" : "items"}</span>}>
      <ul className="divide-y">
        {alerts.map((a, i) => {
          const style = ALERT_STYLE[a.level];
          const Icon = style.icon;
          const body = (
            <>
              <Icon size={16} className={cn("mt-0.5 shrink-0", style.className)} aria-label={style.label} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.title}</div>
                {a.detail && <div className="mt-0.5 text-xs text-fg-muted">{a.detail}</div>}
              </div>
              {a.href && <ArrowRight size={14} className="mt-1 shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5" />}
            </>
          );
          return (
            <li key={`${a.title}-${i}`}>
              {a.href ? (
                <button type="button" onClick={() => navigate({ href: a.href! })} className="group focus-ring flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function HealthTiles({ data }: { data: Overview }) {
  const h = data.health;
  const q = data.queue;
  const cert = h.certDaysLeft;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Services"
        icon={<Server size={16} />}
        tone={h.down.length ? "danger" : "success"}
        value={h.servicesTotal ? `${h.servicesOk} of ${h.servicesTotal} up` : "Unknown"}
        sub={h.down.length ? `Down: ${h.down.join(", ")}` : "All responding"}
      />
      <StatTile
        label="Mail queue"
        icon={<Inbox size={16} />}
        tone={!q ? "neutral" : q.deferred ? "warning" : "success"}
        value={!q ? "Unavailable" : q.total ? `${formatCount(q.total)} waiting` : "Empty"}
        sub={!q ? "Postfix control channel not set up" : q.deferred ? `${q.deferred} deferred, oldest ${q.oldest ? timeAgo(q.oldest) : "?"}` : "All mail delivered"}
      />
      <StatTile
        label={`Failed sign-ins, ${data.range === "24h" ? "24 h" : data.range === "7d" ? "7 days" : "30 days"}`}
        icon={<KeyRound size={16} />}
        tone={data.logins.failed >= 100 ? "warning" : "neutral"}
        value={formatCount(data.logins.failed)}
        sub={`${formatCount(data.logins.succeeded)} successful`}
      />
      <StatTile
        label="TLS certificate"
        icon={<ShieldCheck size={16} />}
        tone={cert === null || h.certSelfSigned ? "warning" : cert < 7 ? "danger" : cert < 21 ? "warning" : "success"}
        value={cert === null ? "Unreadable" : cert < 0 ? "Expired" : `${cert} days left`}
        sub={h.certSelfSigned ? "Self-signed" : cert !== null && cert < 0 ? `${-cert} days ago` : "Renewed automatically"}
      />
    </div>
  );
}

function MailTraffic({ data }: { data: Overview }) {
  const m = data.mail;
  return (
    <Card
      title="Mail traffic"
      action={
        <Link to="/admin/mail" search={{ tab: "log" }} className="text-xs font-medium text-accent hover:underline">
          Mail log
        </Link>
      }
    >
      <ChartLegend series={MAIL_SERIES} totals={m} className="mb-3" />
      <ColumnChart data={m.series} series={MAIL_SERIES} bucket={data.bucket} label={`Messages per ${data.bucket} ${RANGE_TEXT[data.range]}`} />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-fg-muted">
        <span>
          <span className="font-semibold text-fg">{formatCount(m.bounced)}</span> bounced
        </span>
        <span>
          <span className="font-semibold text-fg">{formatCount(m.deferred)}</span> still deferred
        </span>
        {(m.bounced > 0 || m.deferred > 0) && (
          <Link to="/admin/mail" search={{ tab: "log", status: "problems" }} className="ml-auto font-medium text-accent hover:underline">
            Show problems
          </Link>
        )}
      </div>
    </Card>
  );
}

function SignIns({ data }: { data: Overview }) {
  const l = data.logins;
  return (
    <Card
      title="Failed sign-ins"
      action={
        <Link to="/admin/security" search={{ tab: "signins", result: "failed" }} className="text-xs font-medium text-accent hover:underline">
          All sign-ins
        </Link>
      }
    >
      <ColumnChart data={l.series} series={LOGIN_SERIES} bucket={data.bucket} label={`Failed sign-ins per ${data.bucket} ${RANGE_TEXT[data.range]}`} height={140} />
      <div className="mt-3 border-t pt-3">
        <div className="mb-1.5 text-xs font-medium text-fg-muted">Most failed attempts by address</div>
        {l.topFailedIps.length === 0 ? (
          <div className="text-xs text-fg-muted">No failed sign-ins {RANGE_TEXT[data.range]}.</div>
        ) : (
          <ul className="flex flex-col">
            {l.topFailedIps.map((ip) => (
              <li key={ip.ip}>
                <Link
                  to="/admin/security"
                  search={{ tab: "signins", q: ip.ip }}
                  className="-mx-2 flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-surface-2"
                >
                  <span className="w-32 shrink-0 truncate font-mono text-xs">{ip.ip}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{ip.usernames.join(", ") || "no username"}</span>
                  <span className="shrink-0 text-xs text-fg-faint uppercase">{ip.sources.join(" ")}</span>
                  <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{formatCount(ip.failures)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function HostCard({ data }: { data: Overview }) {
  const h = data.host;
  const diskUsed = h.diskTotalBytes && h.diskFreeBytes !== null ? 1 - h.diskFreeBytes / h.diskTotalBytes : null;
  const memUsed = h.memTotalBytes ? 1 - h.memAvailableBytes / h.memTotalBytes : 0;
  const c = data.counts;
  return (
    <Card title="Server">
      <div className="flex flex-col gap-3 text-sm">
        {diskUsed !== null && (
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-fg-muted">Disk</span>
              <span>
                {formatBytes(h.diskFreeBytes!)} free of {formatBytes(h.diskTotalBytes!)}
              </span>
            </div>
            <Meter fraction={diskUsed} label="Disk used" />
          </div>
        )}
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-fg-muted">Memory</span>
            <span>
              {formatBytes(h.memAvailableBytes)} available of {formatBytes(h.memTotalBytes)}
            </span>
          </div>
          <Meter fraction={memUsed} label="Memory used" />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t pt-3 text-xs [&_dd]:text-right [&_dd]:whitespace-nowrap">
          <dt className="text-fg-muted">Load, {h.cpus} CPUs</dt>
          <dd className="tabular-nums" title="1, 5 and 15 minute averages">
            {h.load.map((n) => n.toFixed(2)).join(" · ")}
          </dd>
          <dt className="text-fg-muted">Host uptime</dt>
          <dd>{formatDuration(h.uptimeSeconds)}</dd>
          <dt className="text-fg-muted">Domains · mailboxes · aliases</dt>
          <dd className="tabular-nums">
            {c.domains} · {c.mailboxes} · {c.aliases}
          </dd>
          <dt className="text-fg-muted">Web sessions</dt>
          <dd className="tabular-nums">
            <Link to="/admin/security" search={{ tab: "sessions" }} className="text-accent hover:underline">
              {c.sessions}
            </Link>
          </dd>
        </dl>
      </div>
    </Card>
  );
}

function StorageCard({ data }: { data: Overview }) {
  return (
    <Card title="Largest mailboxes">
      {data.storage.length === 0 ? (
        <div className="text-sm text-fg-muted">Mailbox sizes are being calculated…</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.storage.map((s) => (
            <li key={s.email} className="text-sm">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{s.email}</span>
                <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                  {formatBytes(s.usedBytes)}
                  {s.quotaBytes > 0 ? ` of ${formatBytes(s.quotaBytes)}` : ", no limit"}
                </span>
              </div>
              {s.quotaBytes > 0 && <Meter fraction={s.usedBytes / s.quotaBytes} label={`${s.email} storage used`} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentChanges({ data, now }: { data: Overview; now: number }) {
  return (
    <Card
      title="Recent admin changes"
      action={
        <Link to="/admin/security" search={{ tab: "audit" }} className="text-xs font-medium text-accent hover:underline">
          Audit log
        </Link>
      }
    >
      {data.recentAudit.length === 0 ? (
        <div className="text-sm text-fg-muted">No changes recorded yet.</div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.recentAudit.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{describeAudit(a)}</div>
                <div className="truncate text-xs text-fg-muted">{a.actorEmail ?? "system"}</div>
              </div>
              <time className="shrink-0 text-xs text-fg-faint" dateTime={a.createdAt} title={fullTime(a.createdAt)}>
                {timeAgo(a.createdAt, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AdminOverviewPage() {
  const search = useSearch({ from: "/authed/admin/overview" });
  const navigate = useNavigate();
  const range = search.range ?? "24h";
  const { data, isLoading, error, refetch, isFetching, isPlaceholderData } = useOverview(range);
  const now = useNow();

  return (
    <div className="flex h-full flex-col">
      <AdminHeader
        title="Overview"
        description={
          data ? (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> Updated {timeAgo(data.generatedAt, now)}, refreshes every 30 seconds
            </span>
          ) : (
            "Health and activity of this mail server"
          )
        }
      >
        <Segmented label="Time range" options={RANGES} value={range} onChange={(r) => navigate({ to: "/admin/overview", search: { range: r }, replace: true })} />
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching && !isLoading} aria-label="Refresh">
          <RefreshCw size={13} />
        </Button>
      </AdminHeader>
      <div className="scroll-thin flex-1 overflow-y-auto">
        {isLoading ? (
          <PageSpinner label="Checking the server…" />
        ) : error || !data ? (
          <ErrorState error={error ?? new Error("No data")} retry={() => refetch()} />
        ) : (
          <div className={cn("mx-auto flex max-w-6xl flex-col gap-4 p-5 transition-opacity", isPlaceholderData && "opacity-60")}>
            <Alerts alerts={data.alerts} />
            <HealthTiles data={data} />
            <div className="grid gap-4 lg:grid-cols-2">
              <MailTraffic data={data} />
              <SignIns data={data} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <HostCard data={data} />
              <StorageCard data={data} />
              <RecentChanges data={data} now={now} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
