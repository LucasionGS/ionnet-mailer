import { Check, LockKeyhole, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useDeleteLockout, useLockouts, useServerStatus } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, ErrorState, PageSpinner } from "@/components/ui";
import { AdminHeader } from "./Domains";

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-surface p-4", className)}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

export function AdminStatusPage() {
  const { data, isLoading, error, refetch, isFetching } = useServerStatus();
  const lockouts = useLockouts();
  const unlock = useDeleteLockout();

  return (
    <div className="flex h-full flex-col">
      <AdminHeader title="Status">
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </AdminHeader>
      <div className="scroll-thin flex-1 overflow-y-auto">
        {isLoading ? (
          <PageSpinner />
        ) : error || !data ? (
          <ErrorState error={error ?? new Error("No data")} retry={() => refetch()} />
        ) : (
          <div className="mx-auto grid max-w-4xl gap-4 p-5 md:grid-cols-2">
            <Card title="Server">
              <Row label="Hostname" value={data.hostname} />
              <Row label="Public IP" value={data.publicIp ?? "unknown"} />
              <Row
                label="Reverse DNS"
                value={
                  data.ptr.length ? (
                    <span className={data.ptr.includes(data.hostname) ? "text-success" : "text-warning"}>{data.ptr.join(", ")}</span>
                  ) : (
                    <span className="text-warning">not set</span>
                  )
                }
              />
              <Row label="Version" value={data.version} />
              <Row label="Antivirus" value={data.clamavEnabled ? <Badge tone="success">ClamAV on</Badge> : <Badge tone="neutral">off</Badge>} />
              <Row label="Domains / mailboxes / aliases" value={`${data.counts.domains} / ${data.counts.mailboxes} / ${data.counts.aliases}`} />
            </Card>

            <Card title="TLS certificate">
              {data.certificate ? (
                <>
                  <Row label="Subject" value={data.certificate.subject} />
                  <Row label="Issuer" value={data.certificate.issuer} />
                  <Row label="Valid until" value={new Date(data.certificate.validTo).toLocaleDateString()} />
                  <Row
                    label="Days left"
                    value={
                      <span className={data.certificate.daysLeft < 7 ? "text-danger" : data.certificate.daysLeft < 21 ? "text-warning" : "text-success"}>
                        {data.certificate.daysLeft}
                      </span>
                    }
                  />
                  {data.certificate.selfSigned && (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-xs">
                      <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
                      <span>
                        A temporary self-signed certificate is in use. Mail clients will warn until Let's Encrypt issues a certificate, which
                        requires the hostname's A record to point here and ports 80/443 to be reachable.
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-fg-muted">Certificate information unavailable.</div>
              )}
            </Card>

            <Card title="Services">
              <ul className="divide-y">
                {data.services.map((s) => (
                  <li key={s.name} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", s.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                      {s.ok ? <Check size={12} /> : <X size={12} />}
                    </span>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-auto truncate text-xs text-fg-muted">{s.detail}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Spam filter (rspamd)">
              {data.rspamd ? (
                <>
                  <Row label="Messages scanned" value={data.rspamd.scanned.toLocaleString()} />
                  <Row label="Marked as spam" value={data.rspamd.spam.toLocaleString()} />
                  <Row label="Clean" value={data.rspamd.ham.toLocaleString()} />
                  <Row label="Learned" value={data.rspamd.learned.toLocaleString()} />
                </>
              ) : (
                <div className="text-sm text-fg-muted">Statistics unavailable.</div>
              )}
            </Card>

            <Card title="Login lockouts" className="md:col-span-2">
              {lockouts.isLoading ? (
                <PageSpinner />
              ) : !lockouts.data?.length ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <LockKeyhole size={14} /> No IPs or accounts are currently locked out.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-fg-muted">
                    <tr>
                      <th className="py-1 font-medium">Key</th>
                      <th className="py-1 font-medium">Failed attempts</th>
                      <th className="py-1 font-medium">Locked until</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lockouts.data.map((l) => (
                      <tr key={l.key}>
                        <td className="py-1.5 font-mono text-xs">{l.key}</td>
                        <td className="py-1.5">{l.attempts}</td>
                        <td className="py-1.5 text-xs text-fg-muted">{l.lockedUntil ? new Date(l.lockedUntil).toLocaleString() : "—"}</td>
                        <td className="py-1.5 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => unlock.mutate(l.key, { onError: (e) => toast.error("Could not unlock", errorMessage(e)) })}
                          >
                            Unlock
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
