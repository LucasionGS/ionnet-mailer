import { useState, type FormEvent } from "react";
import { Ban, Plus, ShieldCheck, ShieldOff, X } from "lucide-react";
import type { IpBan } from "@ionnet/shared";
import { useBans, useCreateBan, useLiftBan, useSetAllowlist } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, PageSpinner, Select, Tooltip } from "@/components/ui";
import { Card, Table, formatCount, fullTime, timeAgo, useNow } from "./kit";

const DURATIONS: Array<{ value: string; label: string }> = [
  { value: "1", label: "1 hour" },
  { value: "24", label: "24 hours" },
  { value: String(24 * 7), label: "7 days" },
  { value: String(24 * 30), label: "30 days" },
  { value: "", label: "Permanently" },
];

function hoursLabel(h: number): string {
  if (h % 24 === 0) return `${h / 24} day${h === 24 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** Bans an address or network by hand. `network` prefills the field, e.g. from the sign-in list. */
export function BanDialog({ network, onClose }: { network?: string; onClose: () => void }) {
  const [value, setValue] = useState(network ?? "");
  const [hours, setHours] = useState("24");
  const [reason, setReason] = useState("");
  const create = useCreateBan();

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    try {
      await create.mutateAsync({ network: value.trim(), hours: hours ? Number(hours) : null, reason: reason.trim() || undefined });
      toast.success(`Banned ${value.trim()}`, "It can no longer sign in to the web app or any mail app.");
      onClose();
    } catch (err) {
      toast.error("Could not ban the address", errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ban an address"
      description="A banned address cannot sign in to the web app, IMAP, POP3 or ManageSieve, and Postfix refuses its SMTP connections."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={create.isPending} disabled={!value.trim()} onClick={() => void submit()}>
            <Ban size={13} /> Ban
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="IP address or network" hint="For example 203.0.113.7, or 203.0.113.0/24 for a whole range.">
          <Input autoFocus={!network} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" placeholder="203.0.113.7" required />
        </Field>
        <Field label="For how long">
          <Select value={hours} onChange={(e) => setHours(e.target.value)} options={DURATIONS} />
        </Field>
        <Field label="Note" hint="Optional, shown in the ban list.">
          <Input autoFocus={!!network} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="Password guessing" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function BanStatus({ ban, now }: { ban: IpBan; now: number }) {
  if (ban.liftedAt) {
    return (
      <span className="text-xs text-fg-muted" title={fullTime(ban.liftedAt)}>
        Lifted {timeAgo(ban.liftedAt, now)}
        {ban.liftedBy ? ` by ${ban.liftedBy}` : ""}
      </span>
    );
  }
  if (!ban.expiresAt) return <Badge tone="danger">Permanent</Badge>;
  if (!ban.active) {
    return (
      <span className="text-xs text-fg-muted" title={fullTime(ban.expiresAt)}>
        Ended {timeAgo(ban.expiresAt, now)}
      </span>
    );
  }
  return (
    <time className="text-xs text-fg-muted" dateTime={ban.expiresAt} title={fullTime(ban.expiresAt)}>
      Until {new Date(ban.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

function AllowlistCard({ allowlist }: { allowlist: string[] }) {
  const [value, setValue] = useState("");
  const save = useSetAllowlist();
  const update = (next: string[], done?: () => void) =>
    save.mutate(next, {
      onSuccess: () => {
        done?.();
        toast.success("Allowlist saved");
      },
      onError: (e) => toast.error("Could not save the allowlist", errorMessage(e)),
    });
  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    update([...allowlist, v], () => setValue(""));
  };
  return (
    <Card title="Never ban automatically" bodyClassName="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        Addresses here are never banned automatically, for example an office network where many people sign in. The server's own network always is. You can
        still ban them by hand.
      </p>
      {allowlist.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allowlist.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 rounded-md border bg-surface-2 py-0.5 pr-1 pl-2 font-mono text-xs">
              {a}
              <button
                type="button"
                aria-label={`Remove ${a}`}
                className="focus-ring rounded p-0.5 text-fg-faint hover:text-danger"
                disabled={save.isPending}
                onClick={() => update(allowlist.filter((x) => x !== a))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="203.0.113.0/24" className="max-w-64 font-mono" aria-label="Address or network to allow" />
        <Button type="submit" variant="outline" loading={save.isPending} disabled={!value.trim()}>
          <Plus size={13} /> Add
        </Button>
      </form>
    </Card>
  );
}

export function BansTab() {
  const [showEnded, setShowEnded] = useState(false);
  const { data, isLoading, error, refetch } = useBans(showEnded);
  const lift = useLiftBan();
  const [banning, setBanning] = useState(false);
  const [target, setTarget] = useState<IpBan | null>(null);
  const now = useNow();
  const policy = data?.policy;

  return (
    <div className="flex flex-col gap-4">
      {policy && (
        <p className="text-sm text-fg-muted">
          {policy.enabled ? (
            <>
              An address is banned automatically when, within {policy.windowMinutes} minutes, it fails to sign in for {policy.distinctAccounts} different accounts
              (existing or not) or fails {policy.failures} times in total, through the web app or any mail app. The first ban lasts{" "}
              {hoursLabel(policy.durationHours)}, a second one {hoursLabel(policy.durationHours * 7)} and later ones {hoursLabel(policy.durationHours * 30)}.
              {policy.unknownFailures > 0 && (
                <> Slow guessing counts too: {policy.unknownFailures} tries at accounts that don't exist within {hoursLabel(policy.slowWindowHours)}</>
              )}
              {policy.networkAddresses > 0 && (
                <>
                  {policy.unknownFailures > 0 ? ", and" : " Also,"} {policy.networkAddresses} addresses in one /24 doing so bans the whole range
                </>
              )}
              {(policy.unknownFailures > 0 || policy.networkAddresses > 0) && <> (unless it signed in successfully in the last week).</>}
            </>
          ) : (
            <>Automatic bans are turned off (AUTOBAN_ENABLED=0). Addresses you ban here are still blocked.</>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => setBanning(true)}>
          <Ban size={13} /> Ban an address
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <Checkbox checked={showEnded} onChange={setShowEnded} label="Show ended bans" />
          Show ended bans
        </label>
      </div>
      {isLoading ? (
        <PageSpinner />
      ) : error ? (
        <ErrorState error={error} retry={() => refetch()} />
      ) : !data?.bans.length ? (
        <EmptyState icon={<ShieldCheck size={22} />} title={showEnded ? "No bans yet" : "No address is banned"} description="Addresses that keep guessing passwords show up here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Address</th>
              <th>Why</th>
              <th className="w-28">Banned</th>
              <th className="w-44">Status</th>
              <th className="w-24 text-right">Blocked</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {data.bans.map((b) => (
              <tr key={b.id} className={cn(!b.active && "opacity-60")}>
                <td className="whitespace-nowrap">
                  <span className="font-mono text-xs">{b.network}</span>
                  <Badge tone={b.source === "auto" ? "warning" : "neutral"} className="ml-2">
                    {b.source === "auto" ? "Automatic" : "Manual"}
                  </Badge>
                </td>
                <td className="max-w-0 min-w-48">
                  <div className="truncate text-sm" title={b.reason ?? undefined}>
                    {b.reason ?? <span className="text-fg-faint">No note</span>}
                  </div>
                  {b.createdBy && <div className="truncate text-xs text-fg-muted">by {b.createdBy}</div>}
                </td>
                <td className="text-xs whitespace-nowrap text-fg-muted">
                  <time dateTime={b.createdAt} title={fullTime(b.createdAt)}>
                    {timeAgo(b.createdAt, now)}
                  </time>
                </td>
                <td className="whitespace-nowrap">
                  <BanStatus ban={b} now={now} />
                </td>
                <td className="text-right tabular-nums">
                  <Tooltip content={b.lastHitAt ? `Sign-in attempts and connections turned away, last ${fullTime(b.lastHitAt)}` : "Nothing turned away yet"}>
                    <span>{formatCount(b.hits)}</span>
                  </Tooltip>
                </td>
                <td className="text-right">
                  {b.active && (
                    <Button size="sm" variant="outline" onClick={() => setTarget(b)}>
                      <ShieldOff size={13} /> Lift
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && <AllowlistCard allowlist={data.allowlist} />}
      {banning && <BanDialog onClose={() => setBanning(false)} />}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Lift the ban on ${target?.network ?? ""}?`}
        description="The address can sign in again right away. If it keeps failing, it will be banned again automatically."
        confirmLabel="Lift ban"
        loading={lift.isPending}
        onConfirm={() =>
          target &&
          lift.mutate(target.id, {
            onSuccess: () => {
              toast.success(`Lifted the ban on ${target.network}`);
              setTarget(null);
            },
            onError: (e) => toast.error("Could not lift the ban", errorMessage(e)),
          })
        }
      />
    </div>
  );
}
