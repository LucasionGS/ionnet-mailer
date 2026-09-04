import { useState } from "react";
import { Check, ChevronDown, Copy, HelpCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { DnsCheckResult, DnsRecord } from "@ionnet/shared";
import { cn, copyToClipboard } from "@/lib/utils";
import { Badge, Button, IconButton, Tooltip } from "@/components/ui";
import { toast } from "@/lib/toast";

function statusBadge(s: DnsRecord["status"]) {
  switch (s) {
    case "ok":
      return (
        <Badge tone="success">
          <Check size={11} /> Found
        </Badge>
      );
    case "missing":
      return (
        <Badge tone="danger">
          <X size={11} /> Missing
        </Badge>
      );
    case "mismatch":
      return (
        <Badge tone="warning">
          <TriangleAlert size={11} /> Different value
        </Badge>
      );
    default:
      return <Badge tone="neutral">Not checked</Badge>;
  }
}

function CopyValue({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group flex items-start gap-1">
      <code
        className={cn(
          "min-w-0 flex-1 rounded-md border bg-surface-2 px-2 py-1 text-xs break-all whitespace-pre-wrap select-all",
          mono ? "font-mono" : "",
        )}
      >
        {value}
      </code>
      <IconButton
        size="sm"
        label={copied ? "Copied" : "Copy"}
        onClick={async () => {
          const ok = await copyToClipboard(value);
          setCopied(ok);
          if (!ok) toast.error("Could not copy to clipboard");
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </IconButton>
    </div>
  );
}

function RecordRow({ r }: { r: DnsRecord }) {
  const [open, setOpen] = useState(r.status !== "ok");
  return (
    <div className={cn("rounded-lg border bg-surface transition-colors", r.status === "ok" && "border-success/30")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="w-12 shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-fg-muted">
          {r.type}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{r.title}</span>
          <span className="block truncate font-mono text-xs text-fg-faint">{r.name}</span>
        </span>
        {statusBadge(r.status)}
        <ChevronDown size={16} className={cn("shrink-0 text-fg-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t px-3 py-3 animate-fade-in">
          <p className="text-xs text-fg-muted">{r.description}</p>
          <div className="grid gap-2 sm:grid-cols-[100px_1fr] sm:gap-x-4">
            <div className="text-xs font-medium text-fg-muted sm:pt-1.5">Name / Host</div>
            <CopyValue value={r.name} />
            {r.priority !== undefined && (
              <>
                <div className="text-xs font-medium text-fg-muted sm:pt-1.5">Priority</div>
                <CopyValue value={String(r.priority)} />
              </>
            )}
            <div className="text-xs font-medium text-fg-muted sm:pt-1.5">Value</div>
            <CopyValue value={r.value} />
            {r.ttl !== undefined && (
              <>
                <div className="text-xs font-medium text-fg-muted sm:pt-1.5">TTL</div>
                <div className="text-xs text-fg-muted sm:pt-1.5">{r.ttl} (or your provider's default)</div>
              </>
            )}
          </div>
          {r.status === "mismatch" && r.found.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning-soft p-2 text-xs">
              <div className="mb-1 font-medium text-warning">Currently published:</div>
              {r.found.map((f, i) => (
                <code key={i} className="block font-mono break-all">
                  {f}
                </code>
              ))}
            </div>
          )}
          {r.hint && (
            <div className="flex items-start gap-1.5 text-xs text-fg-muted">
              <HelpCircle size={13} className="mt-0.5 shrink-0" />
              <span>{r.hint}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DnsRecords({
  result,
  onRefresh,
  refreshing,
  compact,
}: {
  result: DnsCheckResult | undefined;
  onRefresh?: () => void;
  refreshing?: boolean;
  compact?: boolean;
}) {
  if (!result) return null;
  const groups: Array<{ key: DnsRecord["group"]; title: string; blurb: string }> = [
    { key: "required", title: "Required", blurb: "Without these, mail will not be delivered or will land in spam." },
    { key: "recommended", title: "Recommended", blurb: "Improve trust with Gmail, Outlook and others. Add them when you can." },
    { key: "optional", title: "Optional", blurb: "Convenience for mail apps and reporting." },
  ];
  const requiredOk = result.records.filter((r) => r.group === "required").every((r) => r.status === "ok");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-fg-muted">
          {requiredOk ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Check size={13} /> All required records for <b>{result.domain}</b> are in place.
            </span>
          ) : (
            <span>
              Add these records at the DNS provider for <b>{result.domain}</b>. Changes can take a few minutes to hours to show up.
            </span>
          )}
          <span className="ml-2 text-fg-faint">Checked {new Date(result.checkedAt).toLocaleTimeString()}</span>
        </div>
        {onRefresh && (
          <Tooltip content="Query public DNS again">
            <Button size="sm" variant="outline" onClick={onRefresh} loading={refreshing}>
              <RefreshCw size={13} /> Re-check
            </Button>
          </Tooltip>
        )}
      </div>
      {groups.map((g) => {
        const items = result.records.filter((r) => r.group === g.key);
        if (!items.length) return null;
        return (
          <section key={g.key} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{g.title}</h3>
              {!compact && <span className="text-xs text-fg-faint">{g.blurb}</span>}
            </div>
            {items.map((r) => (
              <RecordRow key={r.key} r={r} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
