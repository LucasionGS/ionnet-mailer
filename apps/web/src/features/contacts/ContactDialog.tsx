import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { Contact } from "@ionnet/shared";
import { useCreateContact, useUpdateContact } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { Button, Dialog, Field, IconButton, Input, Textarea } from "@/components/ui";

export function ContactDialog({ contact, onClose, initialEmail }: { contact: Contact | null; onClose: () => void; initialEmail?: string }) {
  const [name, setName] = useState(contact?.name ?? "");
  const [emails, setEmails] = useState<string[]>(contact?.emails.length ? contact.emails : [initialEmail ?? ""]);
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const create = useCreateContact();
  const update = useUpdateContact();
  const busy = create.isPending || update.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), emails: emails.map((s) => s.trim().toLowerCase()).filter(Boolean), notes };
    if (!body.emails.length) {
      toast.error("Add at least one email address");
      return;
    }
    try {
      if (contact) await update.mutateAsync({ id: contact.id, body });
      else await create.mutateAsync(body);
      toast.success(contact ? "Contact updated" : "Contact added");
      onClose();
    } catch (err) {
      toast.error("Could not save contact", errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={contact ? "Edit contact" : "New contact"}
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
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email addresses">
          <div className="flex flex-col gap-2">
            {emails.map((em, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  type="email"
                  value={em}
                  onChange={(e) => setEmails((arr) => arr.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder="name@example.com"
                />
                {emails.length > 1 && (
                  <IconButton label="Remove" size="sm" onClick={() => setEmails((arr) => arr.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}
            {emails.length < 10 && (
              <button type="button" className="self-start text-xs font-medium text-accent hover:underline" onClick={() => setEmails((a) => [...a, ""])}>
                <Plus size={12} className="mr-1 inline" />
                Add another
              </button>
            )}
          </div>
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
