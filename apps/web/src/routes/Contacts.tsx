import { useState } from "react";
import { BookUser, Mail, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { Contact } from "@ionnet/shared";
import { useContacts, useDeleteContact } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { avatarColor, cn, initials } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, PageSpinner } from "@/components/ui";
import { ContactDialog } from "@/features/contacts/ContactDialog";
import { openComposer } from "@/features/mail/composerStore";

export function ContactsPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, error, refetch } = useContacts(q);
  const [editing, setEditing] = useState<Contact | null | "new">(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const del = useDeleteContact();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b bg-surface px-5 py-3">
        <h1 className="text-base font-semibold">Contacts</h1>
        <div className="relative ml-auto w-64 max-w-full">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="pl-8" />
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus size={14} /> New contact
        </Button>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto">
        {isLoading ? (
          <PageSpinner />
        ) : error ? (
          <ErrorState error={error} retry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState
            icon={<BookUser size={22} />}
            title={q ? "No contacts match your search" : "No contacts yet"}
            description={q ? undefined : "Contacts are added automatically when you send mail, or add them manually."}
            action={
              !q && (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  <Plus size={14} /> Add contact
                </Button>
              )
            }
          />
        ) : (
          <ul className="mx-auto max-w-3xl divide-y px-5 py-2">
            {data.map((c) => (
              <li key={c.id} className="group flex items-center gap-3 py-2.5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ background: avatarColor(c.emails[0] ?? c.name) }}
                >
                  {initials(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    {c.source === "auto" && <Badge tone="neutral">auto</Badge>}
                  </div>
                  <div className="truncate text-xs text-fg-muted">{c.emails.join(", ")}</div>
                  {c.notes && <div className="mt-0.5 line-clamp-1 text-xs text-fg-faint">{c.notes}</div>}
                </div>
                <div className={cn("flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100")}>
                  <IconButton
                    label="Send email"
                    size="sm"
                    onClick={() => openComposer({ to: [{ name: c.name, address: c.emails[0] ?? "" }] })}
                  >
                    <Mail size={14} />
                  </IconButton>
                  <IconButton label="Edit" size="sm" onClick={() => setEditing(c)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton label="Delete" size="sm" tone="danger" onClick={() => setDeleting(c)}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <ContactDialog contact={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete contact"
        description={deleting ? `Remove ${deleting.name} from your contacts?` : ""}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => {
          if (!deleting) return;
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Contact deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error("Could not delete contact", errorMessage(e)),
          });
        }}
      />
    </div>
  );
}
