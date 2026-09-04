import { useEffect, useState, type FormEvent } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { formatBytes } from "@ionnet/shared";
import { useChangePassword, useMe, useQuota, useUpdateProfile } from "@/lib/queries";
import { useTheme, type ThemeSetting } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn, passwordStrength } from "@/lib/utils";
import { Button, Field, Input, Textarea } from "@/components/ui";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const { data: quota } = useQuota();
  const updateProfile = useUpdateProfile();
  const changePw = useChangePassword();
  const [theme, setTheme] = useTheme();
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [signature, setSignature] = useState(me?.signature ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (me) {
      setDisplayName(me.displayName);
      setSignature(me.signature ?? "");
    }
  }, [me]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync({ displayName: displayName.trim(), signature: signature.trim() ? signature : null });
      toast.success("Profile saved");
    } catch (err) {
      toast.error("Could not save profile", errorMessage(err));
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("New passwords do not match");
      return;
    }
    try {
      await changePw.mutateAsync({ currentPassword: current, newPassword: next });
      toast.success("Password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      toast.error("Could not change password", errorMessage(err));
    }
  };

  const themeOptions: Array<{ v: ThemeSetting; label: string; icon: React.ReactNode }> = [
    { v: "system", label: "System", icon: <Monitor size={15} /> },
    { v: "light", label: "Light", icon: <Sun size={15} /> },
    { v: "dark", label: "Dark", icon: <Moon size={15} /> },
  ];
  const used = quota?.usedBytes ?? 0;
  const limit = quota?.limitBytes ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const strength = passwordStrength(next);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b bg-surface px-5 py-3">
        <h1 className="text-base font-semibold">Settings</h1>
      </header>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-5">
        <Section title="Profile" description={me ? `Signed in as ${me.email}` : undefined}>
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
            <Field label="Display name" hint="Shown as the sender name on outgoing mail.">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} />
            </Field>
            <Field label="Signature" hint="Appended to new messages. Plain text or simple HTML.">
              <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={4} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={updateProfile.isPending}>
                Save
              </Button>
            </div>
          </form>
        </Section>

        <Section title="Password">
          <form onSubmit={savePassword} className="flex flex-col gap-4">
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password" hint={next ? strength.label : "At least 10 characters"}>
                <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
              </Field>
              <Field label="Confirm new password" error={confirm && confirm !== next ? "Passwords do not match" : undefined}>
                <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={changePw.isPending}>
                Change password
              </Button>
            </div>
          </form>
        </Section>

        <Section title="Appearance">
          <div className="flex gap-2">
            {themeOptions.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setTheme(o.v)}
                className={cn(
                  "focus-ring flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors",
                  theme === o.v ? "border-accent bg-accent-soft text-accent" : "hover:bg-surface-2",
                )}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Storage">
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span>{formatBytes(used)} used</span>
            <span>{limit > 0 ? `of ${formatBytes(limit)}` : "No limit"}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn("h-full rounded-full transition-all", pct > 90 ? "bg-danger" : pct > 75 ? "bg-warning" : "bg-accent")}
              style={{ width: limit > 0 ? `${pct}%` : "0%" }}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
