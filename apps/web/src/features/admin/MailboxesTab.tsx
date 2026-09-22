import { useState, type FormEvent } from "react";
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { DomainDetail, Mailbox, MailboxCreate, MailboxUpdate } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { useCreateMailbox, useDeleteMailbox, useMe, useRecalculateQuota, useUpdateMailbox } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { avatarColor, cn, initials } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, Select, Switch } from "@/components/ui";

const QUOTA_OPTIONS = [
  { value: "0", label: "Unlimited" },
  { value: String(1 * 1024 ** 3), label: "1 GB" },
  { value: String(5 * 1024 ** 3), label: "5 GB" },
  { value: String(10 * 1024 ** 3), label: "10 GB" },
  { value: String(25 * 1024 ** 3), label: "25 GB" },
  { value: String(50 * 1024 ** 3), label: "50 GB" },
  { value: String(100 * 1024 ** 3), label: "100 GB" },
];

function MailboxDialog({ domain, mailbox, onClose }: { domain: DomainDetail; mailbox: Mailbox | null; onClose: () => void }) {
  const [localPart, setLocalPart] = useState(mailbox?.localPart ?? "");
  const [displayName, setDisplayName] = useState(mailbox?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [quota, setQuota] = useState(String(mailbox?.quotaBytes ?? 0));
  const [isAdmin, setIsAdmin] = useState(mailbox?.isAdmin ?? false);
  const create = useCreateMailbox(domain.id);
  const update = useUpdateMailbox(domain.id);
  const busy = create.isPending || update.isPending;
  const quotaOptions = QUOTA_OPTIONS.some((o) => o.value === quota) ? QUOTA_OPTIONS : [...QUOTA_OPTIONS, { value: quota, label: formatBytes(Number(quota)) }];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (mailbox) {
        const body: MailboxUpdate = { displayName: displayName.trim(), quotaBytes: Number(quota), isAdmin };
        if (password) body.password = password;
        await update.mutateAsync({ id: mailbox.id, body });
        toast.success("Mailbox updated");
      } else {
        const body: MailboxCreate = {
          localPart: localPart.trim().toLowerCase(),
          displayName: displayName.trim(),
          password,
          quotaBytes: Number(quota),
          isAdmin,
        };
        await create.mutateAsync(body);
        toast.success(`Mailbox ${body.localPart}@${domain.name} created`);
      }
      onClose();
    } catch (err) {
      toast.error("Could not save mailbox", errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mailbox ? `Edit ${mailbox.email}` : "New mailbox"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={(e) => submit(e as unknown as FormEvent)}>
            {mailbox ? "Save" : "Create mailbox"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!mailbox && (
          <Field label="Email address">
            <div className="flex items-center">
              <Input autoFocus value={localPart} onChange={(e) => setLocalPart(e.target.value)} required className="rounded-r-none" placeholder="name" />
              <span className="flex h-8.5 items-center rounded-r-md border border-l-0 border-border-strong bg-surface-2 px-2 text-xs text-fg-muted">
                @{domain.name}
              </span>
            </div>
          </Field>
        )}
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label={mailbox ? "New password (leave blank to keep)" : "Password"} hint="At least 10 characters">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!mailbox} minLength={10} />
        </Field>
        <Field label="Storage quota">
          <Select value={quota} onChange={(e) => setQuota(e.target.value)} options={quotaOptions} />
        </Field>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <div className="text-sm font-medium">Administrator</div>
            <div className="text-xs text-fg-muted">Can manage domains, mailboxes and server settings.</div>
          </div>
          <Switch checked={isAdmin} onChange={setIsAdmin} label="Administrator" />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function MailboxesTab({ domain }: { domain: DomainDetail }) {
  const { data: me } = useMe();
  const [editing, setEditing] = useState<Mailbox | null | "new">(null);
  const [deleting, setDeleting] = useState<Mailbox | null>(null);
  const update = useUpdateMailbox(domain.id);
  const del = useDeleteMailbox(domain.id);
  const recalc = useRecalculateQuota(domain.id);

  const recalculate = (m: Mailbox) =>
    recalc.mutate(m.id, {
      onSuccess: (r) => toast.success(`Storage recalculated for ${m.email}`, r.usedBytes != null ? `${formatBytes(r.usedBytes)} in use` : undefined),
      onError: (e) => toast.error("Could not recalculate storage", errorMessage(e)),
    });

  const toggleActive = (m: Mailbox) =>
    update.mutate(
      { id: m.id, body: { active: !m.active } },
      { onError: (e) => toast.error("Could not update mailbox", errorMessage(e)) },
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-fg-muted">
          {domain.mailboxes.length} {domain.mailboxes.length === 1 ? "mailbox" : "mailboxes"}
        </div>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          <Plus size={13} /> New mailbox
        </Button>
      </div>
      {!domain.mailboxes.length ? (
        <EmptyState icon={<UserRound size={20} />} title="No mailboxes" description="Create the first mailbox for this domain." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Mailbox</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Storage</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y bg-surface">
              {domain.mailboxes.map((m) => {
                const pct = m.quotaBytes > 0 && m.usedBytes != null ? Math.min(100, Math.round((m.usedBytes / m.quotaBytes) * 100)) : 0;
                return (
                  <tr key={m.id} className={cn("group", !m.active && "opacity-60")}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: avatarColor(m.email) }}>
                          {initials(m.displayName || m.email)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{m.displayName}</span>
                            {m.isAdmin && (
                              <Badge tone="accent">
                                <ShieldCheck size={11} /> admin
                              </Badge>
                            )}
                            {me?.id === m.id && <Badge tone="neutral">you</Badge>}
                          </div>
                          <div className="truncate text-xs text-fg-muted">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <div className="text-xs text-fg-muted">
                        {m.usedBytes != null ? formatBytes(m.usedBytes) : "—"} {m.quotaBytes > 0 ? `/ ${formatBytes(m.quotaBytes)}` : "· unlimited"}
                      </div>
                      {m.quotaBytes > 0 && (
                        <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-surface-3">
                          <div className={cn("h-full", pct > 90 ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Switch checked={m.active} onChange={() => toggleActive(m)} label="Active" disabled={me?.id === m.id} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton label="Recalculate storage" size="sm" disabled={recalc.isPending} onClick={() => recalculate(m)}>
                          <RefreshCw size={14} className={cn(recalc.isPending && recalc.variables === m.id && "animate-[spin_0.8s_linear_infinite]")} />
                        </IconButton>
                        <IconButton label="Edit / reset password" size="sm" onClick={() => setEditing(m)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label="Reset password" size="sm" onClick={() => setEditing(m)}>
                          <KeyRound size={14} />
                        </IconButton>
                        <IconButton label="Delete" size="sm" tone="danger" disabled={me?.id === m.id} onClick={() => setDeleting(m)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <MailboxDialog domain={domain} mailbox={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete mailbox"
        description={deleting ? `${deleting.email} will no longer receive mail and can't sign in. Stored messages are not deleted from disk.` : ""}
        confirmLabel="Delete mailbox"
        danger
        requireText={deleting?.localPart}
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Mailbox deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error("Could not delete mailbox", errorMessage(e)),
          })
        }
      />
    </div>
  );
}
