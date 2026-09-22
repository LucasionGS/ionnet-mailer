import { useEffect, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

export function Card({ title, action, children, className, bodyClassName }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border bg-surface", className)}>
      {(title || action) && (
        <div className="flex min-h-11 items-center gap-2 border-b px-4 py-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn("min-w-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: Array<{ key: T; label: ReactNode }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="border-b bg-surface px-5">
      <div className="scroll-thin -mb-px flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={value === t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "focus-ring shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
              value === t.key ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Segmented control for a handful of mutually exclusive options. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "focus-ring h-7 rounded px-2.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Search box that reports its value after the user stops typing. */
export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChange(text.trim());
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="focus-ring h-8.5 w-full rounded-md border border-border-strong bg-surface pr-8 pl-8 text-sm placeholder:text-fg-faint focus:border-accent"
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText("");
            onChange("");
          }}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** The one row of filters above a list. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-3">
      <Button variant="outline" size="sm" loading={loading} onClick={onClick}>
        Load older entries
      </Button>
    </div>
  );
}

export function StatTile({ label, value, sub, icon, tone = "neutral" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const iconTone = { neutral: "bg-surface-2 text-fg-muted", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger" }[tone];
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-surface p-4">
      {icon && <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", iconTone)}>{icon}</span>}
      <div className="min-w-0">
        <div className="truncate text-xs text-fg-muted">{label}</div>
        <div className="mt-0.5 truncate text-xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-fg-muted">{sub}</div>}
      </div>
    </div>
  );
}

/** A filled bar; severity takes over the fill as it gets full. */
export function Meter({ fraction, label }: { fraction: number; label: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  const fill = f >= 0.9 ? "bg-danger" : f >= 0.8 ? "bg-warning" : "bg-accent";
  const track = f >= 0.9 ? "bg-danger-soft" : f >= 0.8 ? "bg-warning-soft" : "bg-accent-soft";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full", track)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
      <div className={cn("h-full rounded-full transition-[width]", fill)} style={{ width: `${Math.max(f * 100, f > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

/** Scrollable table shell with the admin area's column styling. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("scroll-thin overflow-x-auto rounded-lg border bg-surface", className)}>
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-fg-muted [&_thead]:border-b [&_thead]:bg-surface-2/60 [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0">
        {children}
      </table>
    </div>
  );
}

// ---- formatting -------------------------------------------------------------------
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

/** "just now", "5 min ago", "3 hr. ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const s = Math.round((now - d) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 7 * 86_400) return rtf.format(-Math.round(s / 86_400), "day");
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

/** Keeps "just now" / "5 min ago" labels moving without refetching. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** "Firefox on Windows" from a user agent string. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : (ua.split(/[/\s]/)[0] ?? "Unknown");
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}
