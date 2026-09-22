import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, CircleCheck, Copy, Ellipsis, Mails, Pause, Play, RefreshCw, RotateCw, ServerCrash, Trash2 } from "lucide-react";
import type { MailDirection, MailLogEntry, MailLogStatus, QueueMessage, SpamScan } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { useFlushQueue, useMailLog, useQueue, useQueueAction, useSpamHistory } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn, copyToClipboard } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Menu, MenuItem, MenuSeparator, PageSpinner, Select, Tooltip, type BadgeTone } from "@/components/ui";
import { FilterBar, LoadMore, SearchInput, TabBar, Table, fullTime, timeAgo, useNow } from "@/features/admin/kit";
import { AdminHeader } from "./AdminLayout";

type Tab = "log" | "queue" | "spam";
export interface MailSearch {
  tab?: Tab;
  q?: string;
  direction?: MailDirection;
  status?: MailLogStatus | "problems";
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "log", label: "Mail log" },
  { key: "queue", label: "Queue" },
  { key: "spam", label: "Spam filter" },
];

const DESCRIPTIONS: Record<Tab, string> = {
  log: "What happened to every message Postfix accepted, delivered, deferred or rejected.",
  queue: "Messages Postfix has not been able to hand over yet.",
  spam: "How rspamd scored the most recent messages.",
};

// ---- mail log ----------------------------------------------------------------------
const STATUS: Record<MailLogStatus, { label: string; tone: BadgeTone }> = {
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Sent", tone: "success" },
  deferred: { label: "Deferred", tone: "warning" },
  bounced: { label: "Bounced", tone: "danger" },
  expired: { label: "Expired", tone: "danger" },
  rejected: { label: "Rejected", tone: "neutral" },
  deleted: { label: "Deleted", tone: "neutral" },
};

function StatusBadge({ e }: { e: MailLogEntry }) {
  // A 4xx reject (greylisting, missing reverse DNS) asks the sender to try again later.
  if (e.status === "rejected" && e.dsn?.startsWith("4")) return <Badge tone="warning">Temporarily rejected</Badge>;
  const s = STATUS[e.status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function DirectionIcon({ direction }: { direction: MailDirection }) {
  const label = direction === "in" ? "Incoming" : "Outgoing";
  return (
    <Tooltip content={label}>
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", direction === "in" ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-muted")} aria-label={label}>
        {direction === "in" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
      </span>
    </Tooltip>
  );
}

// Where in the SMTP conversation Postfix said no.
const REJECT_STAGE: Record<string, string> = {
  CONNECT: "on connect",
  EHLO: "at the greeting",
  HELO: "at the greeting",
  MAIL: "at the sender",
  RCPT: "at the recipient",
  DATA: "before the content",
  "END-OF-MESSAGE": "after the content scan",
};

/** Rejections are stored as "RCPT: 550 …"; split off the stage for display. */
function rejectReason(detail: string | null): { stage: string | null; reason: string } {
  const m = /^([A-Z-]+): (.*)$/.exec(detail ?? "");
  return m ? { stage: REJECT_STAGE[m[1]!] ?? m[1]!.toLowerCase(), reason: m[2]! } : { stage: null, reason: detail ?? "" };
}

/** The line under the subject: why a message is not simply delivered. */
function problemText(e: MailLogEntry): string | null {
  if (e.status === "delivered" || e.status === "sent" || !e.detail) return null;
  return e.status === "rejected" ? rejectReason(e.detail).reason : e.detail;
}

const SOURCE_LABEL: Record<string, string> = {
  smtp: "SMTP from another server (port 25)",
  submission: "Mail client, submission (port 587)",
  smtps: "Mail client, SMTPS (port 465)",
  app: "The web app",
  local: "Generated on the server",
};

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={cn("min-w-0 text-sm break-words", mono && "font-mono text-xs")}>{children}</dd>
    </>
  );
}

function CopyValue({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="min-w-0 break-all">{value}</span>
      <button
        type="button"
        aria-label="Copy"
        className="shrink-0 rounded p-0.5 text-fg-faint hover:bg-surface-2 hover:text-fg"
        onClick={() => void copyToClipboard(value).then((ok) => ok && toast.success("Copied"))}
      >
        <Copy size={12} />
      </button>
    </span>
  );
}

function MailLogDetail({ e, onClose, onShowMessage }: { e: MailLogEntry; onClose: () => void; onShowMessage: (queueId: string) => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={e.subject || "(no subject)"}
      description={`${e.direction === "in" ? "Incoming" : "Outgoing"} message, ${fullTime(e.firstAt)}`}
      footer={
        e.queueId ? (
          <Button variant="outline" size="sm" onClick={() => onShowMessage(e.queueId!)}>
            All recipients of this message
          </Button>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2">
        <Field label="Status">
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge e={e} />
            {e.dsn && <span className="font-mono text-xs text-fg-muted">{e.dsn}</span>}
            {e.attempts > 1 && <span className="text-xs text-fg-muted">after {e.attempts} attempts</span>}
          </span>
        </Field>
        <Field label="From">{e.sender || <span className="text-fg-muted">&lt;&gt; (a bounce or notification)</span>}</Field>
        <Field label="To">{e.recipient || <span className="text-fg-muted">(none)</span>}</Field>
        {e.origRecipient && <Field label="Originally to">{e.origRecipient} (alias or catch-all)</Field>}
        {e.detail &&
          (e.status === "rejected" ? (
            <Field label="Reason" mono>
              {rejectReason(e.detail).reason}
              {rejectReason(e.detail).stage && <span className="font-sans text-fg-muted"> (rejected {rejectReason(e.detail).stage})</span>}
            </Field>
          ) : (
            <Field label="Server reply" mono>
              {e.detail}
            </Field>
          ))}
        {e.relay && (
          <Field label="Handed to" mono>
            {e.relay}
          </Field>
        )}
        {(e.clientHost || e.clientIp) && (
          <Field label="Received from" mono>
            {e.clientHost ?? "unknown"} [{e.clientIp ?? "?"}]
          </Field>
        )}
        {e.source && <Field label="Submitted via">{SOURCE_LABEL[e.source] ?? e.source}</Field>}
        {e.saslUser && <Field label="Signed in as">{e.saslUser}</Field>}
        {e.size !== null && <Field label="Size">{formatBytes(e.size)}</Field>}
        <Field label="First seen">{fullTime(e.firstAt)}</Field>
        {e.lastAt !== e.firstAt && <Field label="Last update">{fullTime(e.lastAt)}</Field>}
        {e.queueId && (
          <Field label="Queue ID" mono>
            <CopyValue value={e.queueId} />
          </Field>
        )}
        {e.messageId && (
          <Field label="Message-ID" mono>
            <CopyValue value={e.messageId} />
          </Field>
        )}
      </dl>
    </Dialog>
  );
}

function MailLogTab({ search, setSearch }: { search: MailSearch; setSearch: (s: Partial<MailSearch>) => void }) {
  const filter = { q: search.q, direction: search.direction, status: search.status };
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData } = useMailLog(filter);
  const [open, setOpen] = useState<MailLogEntry | null>(null);
  const now = useNow();
  const rows = data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(search.q || search.direction || search.status);

  return (
    <div className="flex flex-col gap-3">
      <FilterBar>
        <SearchInput value={search.q ?? ""} onChange={(q) => setSearch({ q: q || undefined })} placeholder="Search address, subject, queue ID or IP" className="w-full sm:w-80" />
        <Select
          aria-label="Direction"
          value={search.direction ?? ""}
          onChange={(e) => setSearch({ direction: (e.target.value || undefined) as MailDirection | undefined })}
          options={[
            { value: "", label: "Both directions" },
            { value: "in", label: "Incoming" },
            { value: "out", label: "Outgoing" },
          ]}
        />
        <Select
          aria-label="Status"
          value={search.status ?? ""}
          onChange={(e) => setSearch({ status: (e.target.value || undefined) as MailSearch["status"] })}
          options={[
            { value: "", label: "Any status" },
            { value: "problems", label: "Problems (deferred, bounced, expired)" },
            { value: "delivered", label: "Delivered to a mailbox" },
            { value: "sent", label: "Sent to another server" },
            { value: "deferred", label: "Deferred" },
            { value: "bounced", label: "Bounced" },
            { value: "rejected", label: "Rejected" },
            { value: "deleted", label: "Deleted from the queue" },
          ]}
        />
      </FilterBar>
      {isLoading ? (
        <PageSpinner />
      ) : error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState
          icon={<Mails size={22} />}
          title={filtered ? "No matching messages" : "No mail logged yet"}
          description={filtered ? "Try a different search or filter." : "Messages show up here as soon as Postfix handles them."}
        />
      ) : (
        <>
          <Table className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
            <thead>
              <tr>
                <th className="w-24">Time</th>
                <th className="w-8 max-sm:hidden" aria-label="Direction" />
                <th>From / to</th>
                <th className="max-lg:hidden">Subject</th>
                <th className="w-32 max-sm:hidden">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr
                  key={e.id}
                  tabIndex={0}
                  onClick={() => setOpen(e)}
                  onKeyDown={(ev) => ev.key === "Enter" && setOpen(e)}
                  className="focus-ring cursor-pointer hover:bg-surface-2"
                >
                  <td className="text-xs whitespace-nowrap text-fg-muted">
                    <time dateTime={e.firstAt} title={fullTime(e.firstAt)}>
                      {timeAgo(e.firstAt, now)}
                    </time>
                  </td>
                  <td className="max-sm:hidden">
                    <DirectionIcon direction={e.direction} />
                  </td>
                  <td className="max-w-0 min-w-48">
                    <div className="truncate text-xs text-fg-muted">{e.sender || "<>"}</div>
                    <div className="truncate">{e.recipient || "—"}</div>
                    <div className="truncate text-xs text-fg-muted lg:hidden">{e.subject ?? problemText(e)}</div>
                    <div className="mt-1 sm:hidden">
                      <StatusBadge e={e} />
                    </div>
                  </td>
                  <td className="max-w-0 min-w-40 max-lg:hidden">
                    {e.subject ? (
                      <>
                        <div className="truncate">{e.subject}</div>
                        {problemText(e) && <div className="truncate text-xs text-fg-muted">{problemText(e)}</div>}
                      </>
                    ) : (
                      <div className="truncate text-fg-muted">{problemText(e) ?? "(no subject)"}</div>
                    )}
                  </td>
                  <td className="max-sm:hidden">
                    <StatusBadge e={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onClick={() => void fetchNextPage()} />
        </>
      )}
      {open && <MailLogDetail e={open} onClose={() => setOpen(null)} onShowMessage={(queueId) => (setOpen(null), setSearch({ q: queueId, status: undefined, direction: undefined }))} />}
    </div>
  );
}

// ---- queue -------------------------------------------------------------------------
const QUEUE_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  deferred: { label: "Deferred", tone: "warning" },
  hold: { label: "On hold", tone: "neutral" },
  active: { label: "Sending", tone: "accent" },
  incoming: { label: "Incoming", tone: "accent" },
  maildrop: { label: "Incoming", tone: "accent" },
};

function QueueTab() {
  const { data, isLoading, error, refetch, isFetching } = useQueue();
  const act = useQueueAction();
  const flush = useFlushQueue();
  const [deleting, setDeleting] = useState<QueueMessage | null>(null);
  const now = useNow();

  const run = (m: QueueMessage, action: "retry" | "hold" | "release" | "delete", done: string) =>
    act.mutate(
      { queueId: m.queueId, action },
      {
        onSuccess: () => {
          toast.success(done);
          setDeleting(null);
        },
        onError: (e) => toast.error("Postfix refused", errorMessage(e)),
      },
    );

  if (isLoading) return <PageSpinner />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  if (!data?.available) {
    return (
      <EmptyState
        icon={<ServerCrash size={22} />}
        title="The queue can't be read"
        description={data?.error ?? "Postfix did not answer."}
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  const deferred = data.messages.filter((m) => m.queue === "deferred").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-fg-muted">
          {data.messages.length === 0 ? "Nothing is waiting." : `${data.messages.length} ${data.messages.length === 1 ? "message" : "messages"} in the queue, ${deferred} deferred.`} Postfix retries deferred mail on its
          own for up to 5 days before bouncing it.
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!deferred}
            loading={flush.isPending}
            onClick={() => flush.mutate(undefined, { onSuccess: () => toast.success("Retrying all deferred mail now"), onError: (e) => toast.error("Could not retry", errorMessage(e)) })}
          >
            <RotateCw size={13} /> Retry all now
          </Button>
        </div>
      </div>
      {data.messages.length === 0 ? (
        <EmptyState icon={<CircleCheck size={22} />} title="The queue is empty" description="Every message has been delivered or handed to the receiving server." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Message</th>
              <th>Recipients and last error</th>
              <th className="w-24">State</th>
              <th className="w-10" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.messages.map((m) => {
              const state = QUEUE_STATE[m.queue] ?? { label: m.queue, tone: "neutral" as const };
              return (
                <tr key={m.queueId}>
                  <td className="max-w-0 min-w-52">
                    <div className="truncate">{m.sender || "<> (bounce)"}</div>
                    <div className="flex gap-2 text-xs text-fg-muted">
                      <span className="font-mono">{m.queueId}</span>
                      <span>·</span>
                      <time dateTime={m.arrivalTime} title={fullTime(m.arrivalTime)}>
                        {timeAgo(m.arrivalTime, now)}
                      </time>
                      <span>·</span>
                      <span>{formatBytes(m.size)}</span>
                    </div>
                  </td>
                  <td className="max-w-0 min-w-64">
                    {m.recipients.map((r) => (
                      <div key={r.address} className="mb-1 last:mb-0">
                        <div className="truncate">{r.address}</div>
                        {r.reason && <div className="text-xs break-words text-fg-muted">{r.reason}</div>}
                      </div>
                    ))}
                  </td>
                  <td>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </td>
                  <td>
                    <Menu
                      trigger={
                        <IconButton label={`Actions for ${m.queueId}`} size="sm">
                          <Ellipsis size={15} />
                        </IconButton>
                      }
                    >
                      {m.queue !== "hold" && (
                        <MenuItem icon={<RotateCw size={14} />} onSelect={() => run(m, "retry", "Retrying now")}>
                          Retry now
                        </MenuItem>
                      )}
                      {m.queue === "hold" ? (
                        <MenuItem icon={<Play size={14} />} onSelect={() => run(m, "release", "Released")}>
                          Release
                        </MenuItem>
                      ) : (
                        <MenuItem icon={<Pause size={14} />} onSelect={() => run(m, "hold", "Put on hold")}>
                          Hold
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 size={14} />} danger onSelect={() => setDeleting(m)}>
                        Delete…
                      </MenuItem>
                    </Menu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this message from the queue?"
        description={deleting ? `The message from ${deleting.sender || "<>"} to ${deleting.recipients.map((r) => r.address).join(", ")} is dropped without notifying anyone.` : undefined}
        confirmLabel="Delete message"
        danger
        loading={act.isPending}
        onConfirm={() => deleting && run(deleting, "delete", "Message deleted")}
      />
    </div>
  );
}

// ---- spam filter ---------------------------------------------------------------------
function spamVerdict(action: string): { label: string; tone: BadgeTone; group: string } {
  switch (action) {
    case "no action":
      return { label: "Clean", tone: "success", group: "clean" };
    case "add header":
    case "rewrite subject":
      return { label: "Spam", tone: "warning", group: "spam" };
    case "greylist":
    case "soft reject":
      return { label: "Greylisted", tone: "neutral", group: "greylist" };
    case "reject":
      return { label: "Rejected", tone: "danger", group: "reject" };
    default:
      return { label: action || "Unknown", tone: "neutral", group: "other" };
  }
}

function SpamDetail({ scan, onClose }: { scan: SpamScan; onClose: () => void }) {
  const v = spamVerdict(scan.action);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={scan.subject || "(no subject)"} description={`${scan.from || "<>"} → ${scan.to.join(", ")}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={v.tone}>{v.label}</Badge>
        <span>
          Score <span className="font-semibold tabular-nums">{scan.score}</span> <span className="text-fg-muted">of {scan.requiredScore} needed to reject</span>
        </span>
        <span className="text-fg-muted">{fullTime(scan.time)}</span>
        {scan.ip && <span className="font-mono text-xs text-fg-muted">{scan.ip}</span>}
        {scan.user && <span className="text-fg-muted">sent by {scan.user}</span>}
      </div>
      {scan.symbols.length === 0 ? (
        <div className="text-sm text-fg-muted">No rule added or removed points.</div>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Rule</th>
              <th className="w-16 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {scan.symbols.map((s) => (
              <tr key={s.name}>
                <td>
                  <div className="font-mono text-xs">{s.name}</div>
                  {s.description && <div className="text-xs text-fg-muted">{s.description}</div>}
                  {s.options.length > 0 && <div className="truncate text-xs text-fg-faint">{s.options.join(", ")}</div>}
                </td>
                <td className={cn("text-right font-medium tabular-nums", s.score > 0 ? "text-danger" : "text-success")}>
                  {s.score > 0 ? "+" : ""}
                  {s.score}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  );
}

function SpamTab() {
  const { data, isLoading, error, refetch } = useSpamHistory();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [open, setOpen] = useState<SpamScan | null>(null);
  const now = useNow();
  const scans = useMemo(() => {
    const needle = q.toLowerCase();
    return (data?.scans ?? []).filter(
      (s) =>
        (!group || spamVerdict(s.action).group === group) &&
        (!needle || [s.from, s.subject, s.ip ?? "", ...s.to].some((x) => x.toLowerCase().includes(needle))),
    );
  }, [data, q, group]);

  if (isLoading) return <PageSpinner />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  if (!data?.available) return <EmptyState icon={<ServerCrash size={22} />} title="rspamd is not answering" description="Check the rspamd container on the System page." />;

  return (
    <div className="flex flex-col gap-3">
      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="Search address, subject or IP" className="w-full sm:w-72" />
        <Select
          aria-label="Verdict"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          options={[
            { value: "", label: "Every verdict" },
            { value: "clean", label: "Clean" },
            { value: "spam", label: "Spam (delivered to Junk)" },
            { value: "greylist", label: "Greylisted" },
            { value: "reject", label: "Rejected" },
          ]}
        />
        <span className="text-xs text-fg-muted">rspamd keeps its most recent scans only.</span>
      </FilterBar>
      {!scans.length ? (
        <EmptyState icon={<Mails size={22} />} title={data.scans.length ? "No matching scans" : "Nothing scanned yet"} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="w-24">Time</th>
              <th>From / to</th>
              <th className="max-lg:hidden">Subject</th>
              <th className="w-16 text-right">Score</th>
              <th className="w-28">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((s) => {
              const v = spamVerdict(s.action);
              return (
                <tr key={s.id} tabIndex={0} onClick={() => setOpen(s)} onKeyDown={(e) => e.key === "Enter" && setOpen(s)} className="focus-ring cursor-pointer hover:bg-surface-2">
                  <td className="text-xs whitespace-nowrap text-fg-muted">
                    <time dateTime={s.time} title={fullTime(s.time)}>
                      {timeAgo(s.time, now)}
                    </time>
                  </td>
                  <td className="max-w-0 min-w-48">
                    <div className="truncate text-xs text-fg-muted">{s.from || "<>"}</div>
                    <div className="truncate">{s.to.join(", ")}</div>
                  </td>
                  <td className="max-w-0 min-w-40 truncate max-lg:hidden">{s.subject || <span className="text-fg-faint">—</span>}</td>
                  <td className="text-right tabular-nums">{s.score}</td>
                  <td>
                    <Badge tone={v.tone}>{v.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {open && <SpamDetail scan={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---- page ----------------------------------------------------------------------------
export function AdminMailPage() {
  const search = useSearch({ from: "/authed/admin/mail" });
  const navigate = useNavigate();
  const tab = search.tab ?? "log";
  const setSearch = (patch: Partial<MailSearch>) => navigate({ to: "/admin/mail", search: { ...search, ...patch }, replace: true });

  return (
    <div className="flex h-full flex-col">
      <AdminHeader title="Mail flow" description={DESCRIPTIONS[tab]} />
      <TabBar tabs={TABS} value={tab} onChange={(t) => navigate({ to: "/admin/mail", search: { tab: t }, replace: true })} />
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-5" key={tab}>
          {tab === "log" && <MailLogTab search={search} setSearch={setSearch} />}
          {tab === "queue" && <QueueTab />}
          {tab === "spam" && <SpamTab />}
        </div>
      </div>
    </div>
  );
}
