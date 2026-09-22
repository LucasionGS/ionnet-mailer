import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { History, KeyRound, LockKeyhole, LockKeyholeOpen, LogOut, MonitorSmartphone } from "lucide-react";
import type { AuthEvent, AuthFailureReason, AuthSource, WebSession } from "@ionnet/shared";
import { useAudit, useAuthEvents, useDeleteLockout, useFailedIps, useLockouts, useRevokeSession, useWebSessions } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageSpinner, Select, Tooltip } from "@/components/ui";
import { Card, FilterBar, LoadMore, SearchInput, TabBar, Table, describeUserAgent, formatCount, fullTime, timeAgo, useNow } from "@/features/admin/kit";
import { describeAudit } from "@/features/admin/audit";
import { AdminHeader } from "./AdminLayout";

type Tab = "signins" | "lockouts" | "sessions" | "audit";
export interface SecuritySearch {
  tab?: Tab;
  q?: string;
  result?: "success" | "failed";
  source?: AuthSource;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "signins", label: "Sign-ins" },
  { key: "lockouts", label: "Lockouts" },
  { key: "sessions", label: "Web sessions" },
  { key: "audit", label: "Audit log" },
];

const DESCRIPTIONS: Record<Tab, string> = {
  signins: "Every password check: the web app, and IMAP, POP3, SMTP and ManageSieve through Dovecot.",
  lockouts: "Addresses and accounts temporarily blocked from the web sign-in after too many failures.",
  sessions: "Browsers currently signed in to the web app.",
  audit: "Changes made in the admin area, and password changes.",
};

const SOURCE_LABEL: Record<AuthSource, string> = { web: "Web", imap: "IMAP", pop3: "POP3", smtp: "SMTP", sieve: "Sieve", other: "Other" };
const REASON_LABEL: Record<AuthFailureReason, string> = {
  wrong_password: "Wrong password",
  unknown_user: "No such account",
  disabled: "Account disabled",
  locked: "Locked out",
};

// ---- sign-ins ------------------------------------------------------------------------
function FailedIpsCard({ onPick }: { onPick: (ip: string) => void }) {
  const { data } = useFailedIps(24);
  if (!data?.length) return null;
  return (
    <Card title="Most failed attempts in the last 24 hours" bodyClassName="p-2">
      <div className="grid gap-x-4 sm:grid-cols-2">
        {data.slice(0, 8).map((ip) => (
          <button key={ip.ip} type="button" onClick={() => onPick(ip.ip)} className="focus-ring flex items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-surface-2">
            <span className="w-32 shrink-0 truncate font-mono text-xs">{ip.ip}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{ip.usernames.join(", ") || "no username"}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCount(ip.failures)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ResultBadge({ e }: { e: AuthEvent }) {
  if (e.success) return <Badge tone="success">Signed in</Badge>;
  return <Badge tone={e.reason === "locked" ? "warning" : "danger"}>{e.reason ? REASON_LABEL[e.reason] : "Failed"}</Badge>;
}

function SignInsTab({ search, setSearch }: { search: SecuritySearch; setSearch: (s: Partial<SecuritySearch>) => void }) {
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData } = useAuthEvents({ q: search.q, result: search.result, source: search.source });
  const now = useNow();
  const rows = data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(search.q || search.result || search.source);

  return (
    <div className="flex flex-col gap-4">
      {!filtered && <FailedIpsCard onPick={(ip) => setSearch({ q: ip })} />}
      <FilterBar>
        <SearchInput value={search.q ?? ""} onChange={(q) => setSearch({ q: q || undefined })} placeholder="Search account or IP address" className="w-full sm:w-72" />
        <Select
          aria-label="Result"
          value={search.result ?? ""}
          onChange={(e) => setSearch({ result: (e.target.value || undefined) as SecuritySearch["result"] })}
          options={[
            { value: "", label: "Any result" },
            { value: "failed", label: "Failed" },
            { value: "success", label: "Successful" },
          ]}
        />
        <Select
          aria-label="Where"
          value={search.source ?? ""}
          onChange={(e) => setSearch({ source: (e.target.value || undefined) as AuthSource | undefined })}
          options={[
            { value: "", label: "Web and mail apps" },
            { value: "web", label: "Web app" },
            { value: "imap", label: "IMAP" },
            { value: "pop3", label: "POP3" },
            { value: "smtp", label: "SMTP (sending)" },
            { value: "sieve", label: "ManageSieve" },
          ]}
        />
      </FilterBar>
      {isLoading ? (
        <PageSpinner />
      ) : error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState
          icon={<KeyRound size={22} />}
          title={filtered ? "No matching sign-ins" : "No sign-ins recorded yet"}
          description={filtered ? "Try a different search or filter." : "Attempts show up here as people sign in to the web app or connect a mail client."}
        />
      ) : (
        <>
          <Table className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
            <thead>
              <tr>
                <th className="w-28">When</th>
                <th>Account</th>
                <th className="w-20">Via</th>
                <th className="w-36">Result</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="text-xs whitespace-nowrap text-fg-muted">
                    <time dateTime={e.lastAt} title={e.count > 1 ? `${fullTime(e.firstAt)} – ${fullTime(e.lastAt)}` : fullTime(e.lastAt)}>
                      {timeAgo(e.lastAt, now)}
                    </time>
                  </td>
                  <td className="max-w-0 min-w-44">
                    <div className="truncate">{e.username ?? <span className="text-fg-faint">(none)</span>}</div>
                  </td>
                  <td>
                    <Badge tone="neutral">{SOURCE_LABEL[e.source]}</Badge>
                  </td>
                  <td className="whitespace-nowrap">
                    <ResultBadge e={e} />
                    {e.count > 1 && (
                      <Tooltip content={`${e.count} identical attempts between ${fullTime(e.firstAt)} and ${fullTime(e.lastAt)}`}>
                        <span className="ml-1.5 text-xs font-medium text-fg-muted tabular-nums">×{formatCount(e.count)}</span>
                      </Tooltip>
                    )}
                  </td>
                  <td className="max-w-0 min-w-40">
                    {e.ip ? (
                      <button type="button" className="font-mono text-xs hover:text-accent hover:underline" onClick={() => setSearch({ q: e.ip! })} title="Show everything from this address">
                        {e.ip}
                      </button>
                    ) : (
                      <span className="text-xs text-fg-faint">unknown</span>
                    )}
                    <div className="truncate text-xs text-fg-muted">{e.source === "web" ? describeUserAgent(e.userAgent) : e.detail}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onClick={() => void fetchNextPage()} />
        </>
      )}
    </div>
  );
}

// ---- lockouts ------------------------------------------------------------------------
function LockoutsTab() {
  const { data, isLoading, error, refetch } = useLockouts();
  const unlock = useDeleteLockout();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        The web sign-in locks an account after 8 failed attempts, and an IP address after 20, within 15 minutes. A lockout lasts 15 minutes. Mail apps are
        slowed down by Dovecot and Postfix instead and never appear here.
      </p>
      {isLoading ? (
        <PageSpinner />
      ) : error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={<LockKeyhole size={22} />} title="Nobody is locked out" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Locked</th>
              <th className="w-32">Failed attempts</th>
              <th className="w-44">Until</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {data.map((l) => {
              const [kind, ...rest] = l.key.split(":");
              return (
                <tr key={l.key}>
                  <td>
                    <span className="mr-2 text-xs text-fg-muted">{kind === "ip" ? "IP address" : "Account"}</span>
                    <span className={cn(kind === "ip" && "font-mono text-xs")}>{rest.join(":")}</span>
                  </td>
                  <td className="tabular-nums">{l.attempts}</td>
                  <td className="text-xs text-fg-muted">{l.lockedUntil ? new Date(l.lockedUntil).toLocaleTimeString() : "—"}</td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={unlock.isPending && unlock.variables === l.key}
                      onClick={() => unlock.mutate(l.key, { onSuccess: () => toast.success("Lockout lifted"), onError: (e) => toast.error("Could not unlock", errorMessage(e)) })}
                    >
                      <LockKeyholeOpen size={13} /> Unlock
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// ---- sessions ------------------------------------------------------------------------
function SessionsTab() {
  const { data, isLoading, error, refetch } = useWebSessions();
  const revoke = useRevokeSession();
  const [target, setTarget] = useState<WebSession | null>(null);
  const now = useNow();
  if (isLoading) return <PageSpinner />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  if (!data?.length) return <EmptyState icon={<MonitorSmartphone size={22} />} title="No one is signed in" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">Signing out a session ends it at once. Mail apps (IMAP, SMTP) use the account password and are not affected; reset the password to cut them off.</p>
      <Table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Device</th>
            <th className="w-28">Signed in</th>
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.id}>
              <td className="max-w-0 min-w-44">
                <div className="truncate">{s.email}</div>
                {s.current && <div className="text-xs text-accent">This browser</div>}
              </td>
              <td className="max-w-0 min-w-40">
                <div className="truncate">{describeUserAgent(s.userAgent)}</div>
                <div className="font-mono text-xs text-fg-muted">{s.ip ?? "unknown address"}</div>
              </td>
              <td className="text-xs whitespace-nowrap text-fg-muted">
                <time dateTime={s.createdAt} title={`${fullTime(s.createdAt)}, expires ${fullTime(s.expiresAt)}`}>
                  {timeAgo(s.createdAt, now)}
                </time>
              </td>
              <td className="text-right">
                {!s.current && (
                  <Button size="sm" variant="outline" onClick={() => setTarget(s)}>
                    <LogOut size={13} /> Sign out
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Sign out this session?"
        description={target ? `${target.email} on ${describeUserAgent(target.userAgent)} will have to sign in again.` : undefined}
        confirmLabel="Sign out"
        danger
        loading={revoke.isPending}
        onConfirm={() =>
          target &&
          revoke.mutate(target.id, {
            onSuccess: () => {
              toast.success("Session signed out");
              setTarget(null);
            },
            onError: (e) => toast.error("Could not sign out the session", errorMessage(e)),
          })
        }
      />
    </div>
  );
}

// ---- audit ---------------------------------------------------------------------------
function AuditTab({ q, setQ }: { q: string; setQ: (q: string) => void }) {
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useAudit(q);
  const now = useNow();
  const rows = data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="Search action, account or admin" className="w-full sm:w-72" />
      </FilterBar>
      {isLoading ? (
        <PageSpinner />
      ) : error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={<History size={22} />} title={q ? "No matching changes" : "No changes recorded yet"} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th className="w-28">When</th>
                <th>Change</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="text-xs whitespace-nowrap text-fg-muted">
                    <time dateTime={a.createdAt} title={fullTime(a.createdAt)}>
                      {timeAgo(a.createdAt, now)}
                    </time>
                  </td>
                  <td className="max-w-0 min-w-60">
                    <div className="truncate">{describeAudit(a)}</div>
                    <div className="font-mono text-[11px] text-fg-faint">{a.action}</div>
                  </td>
                  <td className="max-w-0 min-w-40">
                    <div className="truncate">{a.actorEmail ?? "system"}</div>
                    {a.ip && <div className="font-mono text-xs text-fg-muted">{a.ip}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onClick={() => void fetchNextPage()} />
        </>
      )}
    </div>
  );
}

// ---- page ----------------------------------------------------------------------------
export function AdminSecurityPage() {
  const search = useSearch({ from: "/authed/admin/security" });
  const navigate = useNavigate();
  const tab = search.tab ?? "signins";
  const setSearch = (patch: Partial<SecuritySearch>) => navigate({ to: "/admin/security", search: { ...search, ...patch }, replace: true });

  return (
    <div className="flex h-full flex-col">
      <AdminHeader title="Security" description={DESCRIPTIONS[tab]} />
      <TabBar tabs={TABS} value={tab} onChange={(t) => navigate({ to: "/admin/security", search: { tab: t }, replace: true })} />
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-5" key={tab}>
          {tab === "signins" && <SignInsTab search={search} setSearch={setSearch} />}
          {tab === "lockouts" && <LockoutsTab />}
          {tab === "sessions" && <SessionsTab />}
          {tab === "audit" && <AuditTab q={search.q ?? ""} setQ={(q) => setSearch({ q: q || undefined })} />}
        </div>
      </div>
    </div>
  );
}
