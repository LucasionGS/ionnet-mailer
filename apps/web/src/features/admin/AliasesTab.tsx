import { useState, type FormEvent } from "react";
import { ArrowRight, AtSign, Pencil, Plus, Trash2 } from "lucide-react";
import type { Alias, DomainDetail } from "@ionnet/shared";
import { useCreateAlias, useDeleteAlias, useUpdateAlias, useUpdateDomain } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, Switch } from "@/components/ui";

function AliasDialog({ domain, alias, onClose }: { domain: DomainDetail; alias: Alias | null; onClose: () => void }) {
  const [localPart, setLocalPart] = useState(alias ? alias.source.split("@")[0] ?? "" : "");
  const [destination, setDestination] = useState(alias?.destination ?? "");
  const create = useCreateAlias(domain.id);
  const update = useUpdateAlias(domain.id);
  const busy = create.isPending || update.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (alias) {
        await update.mutateAsync({ id: alias.id, body: { destination: destination.trim().toLowerCase() } });
        toast.success("Alias updated");
      } else {
        await create.mutateAsync({ localPart: localPart.trim().toLowerCase(), destination: destination.trim().toLowerCase() });
        toast.success("Alias created");
      }
      onClose();
    } catch (err) {
      toast.error("Could not save alias", errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={alias ? "Edit alias" : "New alias"}
      description="Mail sent to the alias is delivered to the destination. The destination can be a mailbox here or any external address."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={(e) => submit(e as unknown as FormEvent)}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Alias address">
          <div className="flex items-center">
            <Input autoFocus={!alias} disabled={!!alias} value={localPart} onChange={(e) => setLocalPart(e.target.value)} required className="rounded-r-none" placeholder="sales" />
            <span className="flex h-8.5 items-center rounded-r-md border border-l-0 border-border-strong bg-surface-2 px-2 text-xs text-fg-muted">
              @{domain.name}
            </span>
          </div>
        </Field>
        <Field label="Deliver to" hint="Mailbox or external email address.">
          <Input type="email" list={`mailboxes-${domain.id}`} value={destination} onChange={(e) => setDestination(e.target.value)} required placeholder="someone@example.com" />
          <datalist id={`mailboxes-${domain.id}`}>
            {domain.mailboxes.map((m) => (
              <option key={m.id} value={m.email} />
            ))}
          </datalist>
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function AliasesTab({ domain }: { domain: DomainDetail }) {
  const [editing, setEditing] = useState<Alias | null | "new">(null);
  const [deleting, setDeleting] = useState<Alias | null>(null);
  const [catchAll, setCatchAll] = useState(domain.catchAll ?? "");
  const update = useUpdateAlias(domain.id);
  const del = useDeleteAlias(domain.id);
  const updateDomain = useUpdateDomain(domain.id);
  const aliases = domain.aliases.filter((a) => !a.source.startsWith("@"));

  const saveCatchAll = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateDomain.mutateAsync({ catchAll: catchAll.trim() ? catchAll.trim().toLowerCase() : null });
      toast.success(catchAll.trim() ? "Catch-all enabled" : "Catch-all disabled");
    } catch (err) {
      toast.error("Could not update catch-all", errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <AtSign size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Catch-all</div>
            <p className="text-xs text-fg-muted">
              Deliver mail sent to <b>any</b> address at @{domain.name} that isn't a mailbox or alias to one destination. Handy, but
              it also attracts spam.
            </p>
            <form onSubmit={saveCatchAll} className="mt-3 flex items-center gap-2">
              <Input
                type="email"
                value={catchAll}
                onChange={(e) => setCatchAll(e.target.value)}
                placeholder="Disabled — enter a destination to enable"
                className="max-w-sm"
              />
              <Button type="submit" variant="outline" size="md" loading={updateDomain.isPending} disabled={(domain.catchAll ?? "") === catchAll.trim().toLowerCase()}>
                Save
              </Button>
              {domain.catchAll && <Badge tone="success" dot>active</Badge>}
            </form>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <div className="text-xs text-fg-muted">
          {aliases.length} {aliases.length === 1 ? "alias" : "aliases"}
        </div>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          <Plus size={13} /> New alias
        </Button>
      </div>
      {!aliases.length ? (
        <EmptyState icon={<AtSign size={20} />} title="No aliases" description="Aliases forward mail to a mailbox or an external address." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Alias</th>
                <th className="px-3 py-2 font-medium">Delivers to</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y bg-surface">
              {aliases.map((a) => (
                <tr key={a.id} className={cn("group", !a.active && "opacity-60")}>
                  <td className="px-3 py-2 font-medium">{a.source}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-fg-muted">
                      <ArrowRight size={13} className="text-fg-faint" />
                      {a.destination}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={a.active}
                      onChange={(v) => update.mutate({ id: a.id, body: { active: v } }, { onError: (e) => toast.error("Could not update alias", errorMessage(e)) })}
                      label="Active"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton label="Edit" size="sm" onClick={() => setEditing(a)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton label="Delete" size="sm" tone="danger" onClick={() => setDeleting(a)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AliasDialog domain={domain} alias={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete alias"
        description={deleting ? `Mail to ${deleting.source} will bounce after this.` : ""}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Alias deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error("Could not delete alias", errorMessage(e)),
          })
        }
      />
    </div>
  );
}
