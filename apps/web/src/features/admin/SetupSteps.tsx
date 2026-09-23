import { useState, type FormEvent, type ReactNode } from "react";
import { Check, CircleCheck, CircleDashed, CircleSlash, X } from "lucide-react";
import type { SetupStep, SetupStepKey, SetupStepState } from "@ionnet/shared";
import { useApplyReportAddresses, useDomains, useMe, useSetupSteps, useSkipSetupStep } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, ErrorState, Field, Input, PageSpinner, Select, type BadgeTone } from "@/components/ui";
import { Segmented } from "./kit";

/** How many setup steps still need an admin; skipped ones don't count. */
export function usePendingSetupSteps(enabled = true): number {
  const { data } = useSetupSteps(enabled);
  return data?.filter((s) => s.state === "todo").length ?? 0;
}

const STATE: Record<SetupStepState, { label: string; tone: BadgeTone; icon: ReactNode }> = {
  done: { label: "Done", tone: "success", icon: <CircleCheck size={18} className="text-success" /> },
  todo: { label: "To do", tone: "warning", icon: <CircleDashed size={18} className="text-warning" /> },
  skipped: { label: "Skipped", tone: "neutral", icon: <CircleSlash size={18} className="text-fg-faint" /> },
};

// ---- report addresses ----------------------------------------------------------------
function ReportAddressesForm({ step, forwardTo }: { step: SetupStep; forwardTo?: string }) {
  const { data: me } = useMe();
  const { data: domains } = useDomains();
  const apply = useApplyReportAddresses();
  const [mode, setMode] = useState<"forward" | "mailbox">("forward");
  const [destination, setDestination] = useState<string | null>(null);
  const [localPart, setLocalPart] = useState("reports");
  const [domainId, setDomainId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("DMARC and TLS reports");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const missing = step.items.filter((i) => !i.done).length;
  const target = destination ?? forwardTo ?? me?.email ?? "";
  const domain = domainId ?? domains?.find((d) => d.active)?.id ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "mailbox" && password !== confirm) return setError("Passwords do not match.");
    try {
      await apply.mutateAsync(
        mode === "forward"
          ? { mode, destination: target.trim().toLowerCase() }
          : { mode, domainId: domain, localPart: localPart.trim().toLowerCase(), displayName: displayName.trim(), password },
      );
      toast.success("Report addresses created");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Segmented
        label="Where reports go"
        value={mode}
        onChange={setMode}
        options={[
          { value: "forward", label: "Forward to a mailbox" },
          { value: "mailbox", label: "Separate mailbox" },
        ]}
      />
      {mode === "forward" ? (
        <Field label="Forward reports to" hint="Reports arrive as machine-readable attachments, a few a day for a busy domain.">
          <Input type="email" value={target} onChange={(e) => setDestination(e.target.value)} placeholder="you@example.com" required />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mailbox address" className="sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <Input value={localPart} onChange={(e) => setLocalPart(e.target.value)} required className="min-w-0 flex-1" />
              <span className="text-sm text-fg-muted">@</span>
              <Select
                aria-label="Domain"
                className="min-w-0 flex-1"
                value={domain}
                onChange={(e) => setDomainId(e.target.value)}
                options={(domains ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }))}
              />
            </div>
          </Field>
          <Field label="Display name" className="sm:col-span-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field label="Password" hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          </Field>
          <Field label="Confirm password" error={confirm && confirm !== password ? "Passwords do not match" : undefined}>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
        </div>
      )}
      {error && <div className="text-xs text-danger">{error}</div>}
      <div>
        <Button type="submit" variant="primary" loading={apply.isPending}>
          {mode === "forward" ? `Create ${missing} ${missing === 1 ? "alias" : "aliases"}` : "Create mailbox and aliases"}
        </Button>
      </div>
    </form>
  );
}

const FORMS: Record<SetupStepKey, (p: { step: SetupStep; forwardTo?: string }) => ReactNode> = {
  "report-addresses": (p) => <ReportAddressesForm {...p} />,
};

// ---- list ----------------------------------------------------------------------------
function SetupStepCard({ step, forwardTo }: { step: SetupStep; forwardTo?: string }) {
  const skip = useSkipSetupStep();
  const s = STATE[step.state];
  const toggleSkip = (skipped: boolean) => skip.mutate({ key: step.key, skipped }, { onError: (e) => toast.error("Could not update the step", errorMessage(e)) });

  return (
    <section className="rounded-lg border bg-surface">
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 shrink-0">{s.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{step.title}</h2>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{step.description}</p>
        </div>
      </div>
      {step.items.length > 0 && (
        <ul className="border-t px-4 py-2">
          {step.items.map((i) => (
            <li key={i.label} className="flex items-start gap-2 py-1 text-sm">
              {i.done ? <Check size={14} className="mt-0.5 shrink-0 text-success" /> : <X size={14} className="mt-0.5 shrink-0 text-warning" />}
              <span className="font-mono text-xs leading-5">{i.label}</span>
              <span className={cn("min-w-0 text-xs leading-5", i.done ? "text-fg-muted" : "text-fg")}>{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {step.state !== "done" && (
        <div className="flex flex-col gap-3 border-t p-4">
          {step.state === "todo" ? (
            <>
              {FORMS[step.key]({ step, forwardTo })}
              <button type="button" className="self-start text-xs text-fg-muted hover:text-fg hover:underline" onClick={() => toggleSkip(true)} disabled={skip.isPending}>
                Skip, I'll handle this myself
              </button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
              Skipped, so it doesn't count towards the badge in the admin menu.
              <Button variant="outline" size="sm" onClick={() => toggleSkip(false)} loading={skip.isPending}>
                Reopen
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Every setup step with its state and the form to complete it. The first-run wizard and
 * Admin → Setup steps both render this, so a step works the same in either place.
 * `forwardTo` is the address offered by default when a step forwards mail somewhere.
 */
export function SetupStepList({ forwardTo }: { forwardTo?: string }) {
  const { data, isLoading, error, refetch } = useSetupSteps();
  if (isLoading) return <PageSpinner />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  return (
    <div className="flex flex-col gap-3">
      {data?.map((step) => (
        <SetupStepCard key={step.key} step={step} forwardTo={forwardTo} />
      ))}
    </div>
  );
}
