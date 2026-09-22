import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Globe, Plus } from "lucide-react";
import type { Domain } from "@ionnet/shared";
import { useCreateDomain, useDomains } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, PageSpinner } from "@/components/ui";
import { DomainDnsBadge } from "@/features/admin/DomainDnsBadge";
import { AdminHeader } from "./AdminLayout";

function DomainRow({ d }: { d: Domain }) {
  return (
    <Link
      to="/admin/domains/$id"
      params={{ id: d.id }}
      className="group flex items-center gap-4 rounded-lg border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Globe size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{d.name}</span>
          {!d.active && <Badge tone="warning">Disabled</Badge>}
          {d.catchAll && <Badge tone="neutral">catch-all</Badge>}
        </div>
        <div className="text-xs text-fg-muted">
          {d.mailboxCount} {d.mailboxCount === 1 ? "mailbox" : "mailboxes"} · {d.aliasCount} {d.aliasCount === 1 ? "alias" : "aliases"}
        </div>
      </div>
      <DomainDnsBadge id={d.id} />
      <ChevronRight size={16} className="text-fg-faint transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function AdminDomainsPage() {
  const { data, isLoading, error, refetch } = useDomains();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateDomain();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const d = await create.mutateAsync({ name: name.trim().toLowerCase() });
      toast.success(`Domain ${d.name} added`, "Next: publish its DNS records.");
      setAdding(false);
      setName("");
    } catch (err) {
      toast.error("Could not add domain", errorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <AdminHeader title="Domains" description="Domains this server receives mail for, with their mailboxes, aliases and DNS.">
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add domain
        </Button>
      </AdminHeader>
      <div className="scroll-thin flex-1 overflow-y-auto">
        {isLoading ? (
          <PageSpinner />
        ) : error ? (
          <ErrorState error={error} retry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState icon={<Globe size={22} />} title="No domains yet" description="Add the domain you want to receive and send mail for." />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2 p-5">
            {data.map((d) => (
              <DomainRow key={d.id} d={d} />
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add domain"
        description="A DKIM key is generated automatically. You'll get the DNS records to publish right after."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={(e) => submit(e as unknown as FormEvent)}>
              Add domain
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          <Field label="Domain name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" required />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Dialog>
    </div>
  );
}
