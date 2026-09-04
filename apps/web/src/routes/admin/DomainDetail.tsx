import { useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { useDeleteDomain, useDomain, useDomainDns, useRefreshDomainDns, useUpdateDomain } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, ErrorState, PageSpinner, Switch } from "@/components/ui";
import { DnsRecords } from "@/components/DnsRecords";
import { AdminHeader } from "./Domains";
import { MailboxesTab } from "@/features/admin/MailboxesTab";
import { AliasesTab } from "@/features/admin/AliasesTab";

type Tab = "mailboxes" | "aliases" | "dns" | "settings";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "mailboxes", label: "Mailboxes" },
  { key: "aliases", label: "Aliases" },
  { key: "dns", label: "DNS" },
  { key: "settings", label: "Settings" },
];

export function AdminDomainDetailPage() {
  const { id } = useParams({ from: "/authed/admin/domains/$id" });
  const search = useSearch({ from: "/authed/admin/domains/$id" });
  const navigate = useNavigate();
  const tab: Tab = search.tab ?? "mailboxes";
  const { data: domain, isLoading, error, refetch } = useDomain(id);
  const dns = useDomainDns(id);
  const refreshDns = useRefreshDomainDns(id);
  const update = useUpdateDomain(id);
  const del = useDeleteDomain();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setTab = (t: Tab) => navigate({ to: "/admin/domains/$id", params: { id }, search: { tab: t }, replace: true });

  if (isLoading) return <PageSpinner />;
  if (error || !domain) return <ErrorState error={error ?? new Error("Domain not found")} retry={() => refetch()} />;

  return (
    <div className="flex h-full flex-col">
      <AdminHeader title={domain.name}>
        {!domain.active && <Badge tone="warning">Disabled</Badge>}
      </AdminHeader>
      <div className="border-b bg-surface px-5">
        <div className="mx-auto flex max-w-4xl gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "focus-ring -mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
                tab === t.key ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.key === "dns" && dns.data && !dns.data.allRequiredOk && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle" />}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-5 animate-fade-in" key={tab}>
          {tab === "mailboxes" && <MailboxesTab domain={domain} />}
          {tab === "aliases" && <AliasesTab domain={domain} />}
          {tab === "dns" &&
            (dns.isLoading ? (
              <PageSpinner label="Checking DNS…" />
            ) : dns.error ? (
              <ErrorState error={dns.error} retry={() => dns.refetch()} />
            ) : (
              <DnsRecords result={dns.data} onRefresh={() => refreshDns.mutate()} refreshing={refreshDns.isPending} />
            ))}
          {tab === "settings" && (
            <div className="flex flex-col gap-4">
              <section className="flex items-center justify-between rounded-lg border bg-surface p-4">
                <div>
                  <div className="text-sm font-medium">Domain active</div>
                  <div className="text-xs text-fg-muted">When disabled, mail for this domain is rejected and its users cannot sign in.</div>
                </div>
                <Switch
                  checked={domain.active}
                  onChange={(v) => update.mutate({ active: v }, { onError: (e) => toast.error("Could not update domain", errorMessage(e)) })}
                  label="Domain active"
                />
              </section>
              <section className="rounded-lg border bg-surface p-4">
                <div className="text-sm font-medium">DKIM</div>
                <div className="mt-1 text-xs text-fg-muted">
                  Selector <code className="font-mono">{domain.dkimSelector}</code>. The key was generated when the domain was added; the public part is
                  published via the DNS tab.
                </div>
              </section>
              <section className="rounded-lg border border-danger/30 bg-surface p-4">
                <div className="text-sm font-medium text-danger">Delete domain</div>
                <div className="mt-1 text-xs text-fg-muted">
                  Removes the domain, its {domain.mailboxCount} mailbox(es) and {domain.aliasCount} alias(es). Mail to this domain will bounce.
                </div>
                <Button variant="danger" size="sm" className="mt-3" onClick={() => setConfirmDelete(true)}>
                  <Globe size={13} /> Delete {domain.name}
                </Button>
              </section>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${domain.name}`}
        description="This cannot be undone."
        confirmLabel="Delete domain"
        danger
        requireText={domain.name}
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(domain.id, {
            onSuccess: () => {
              toast.success(`Deleted ${domain.name}`);
              navigate({ to: "/admin/domains" });
            },
            onError: (e) => toast.error("Could not delete domain", errorMessage(e)),
          })
        }
      />
    </div>
  );
}
