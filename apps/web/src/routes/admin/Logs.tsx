import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Radio, RefreshCw, ScrollText, ServerCrash } from "lucide-react";
import type { LogLevel, LogSource } from "@ionnet/shared";
import { useLogs } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button, Checkbox, EmptyState, ErrorState, PageSpinner, Select } from "@/components/ui";
import { FilterBar, SearchInput, Segmented } from "@/features/admin/kit";
import { AdminHeader } from "./AdminLayout";

export interface LogsSearch {
  source?: LogSource;
  level?: LogLevel;
  q?: string;
}

const SOURCES: Array<{ value: LogSource; label: string }> = [
  { value: "postfix", label: "Postfix" },
  { value: "dovecot", label: "Dovecot" },
  { value: "app", label: "Web app" },
];
const HINT: Record<LogSource, string> = {
  postfix: "Sending and receiving: connections, deliveries, rejections.",
  dovecot: "Mailbox access: IMAP and POP3 sessions, sign-ins, delivery into folders.",
  app: "The web app and admin API.",
};

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "",
  warn: "bg-warning-soft/60",
  error: "bg-danger-soft/70",
};

function lineTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function AdminLogsPage() {
  const search = useSearch({ from: "/authed/admin/logs" });
  const navigate = useNavigate();
  const source = search.source ?? "postfix";
  const [live, setLive] = useState(true);
  const [own, setOwn] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useLogs({ source, level: search.level, q: search.q, own }, live);
  const setSearch = (patch: Partial<LogsSearch>) => navigate({ to: "/admin/logs", search: { ...search, ...patch }, replace: true });

  // Stick to the newest line while the user is at the bottom; leave them alone once they scroll up.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [data]);
  useEffect(() => {
    atBottom.current = true;
  }, [source, search.level, search.q]);

  return (
    <div className="flex h-full flex-col">
      <AdminHeader title="Server logs" description={HINT[source]}>
        <Button variant={live ? "secondary" : "outline"} size="sm" onClick={() => setLive((v) => !v)} aria-pressed={live}>
          <Radio size={13} className={cn(live && "text-success")} /> {live ? "Live" : "Paused"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching && !live} aria-label="Refresh">
          <RefreshCw size={13} />
        </Button>
      </AdminHeader>
      <div className="border-b bg-surface px-5 py-3">
        <FilterBar>
          <Segmented label="Log" options={SOURCES} value={source} onChange={(s) => setSearch({ source: s })} />
          <Select
            aria-label="Level"
            value={search.level ?? ""}
            onChange={(e) => setSearch({ level: (e.target.value || undefined) as LogLevel | undefined })}
            options={[
              { value: "", label: "All lines" },
              { value: "warn", label: "Warnings and errors" },
              { value: "error", label: "Errors only" },
            ]}
          />
          <SearchInput value={search.q ?? ""} onChange={(q) => setSearch({ q: q || undefined })} placeholder="Filter lines" className="w-full sm:w-64" />
          {source !== "app" && (
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <Checkbox checked={own} onChange={setOwn} label="Include the web app's own connections" />
              Include the web app's own connections
            </label>
          )}
        </FilterBar>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface"
      >
        {isLoading ? (
          <PageSpinner />
        ) : error ? (
          <ErrorState error={error} retry={() => refetch()} />
        ) : !data?.available ? (
          <EmptyState icon={<ServerCrash size={22} />} title="This log can't be read" description={data?.note ?? undefined} />
        ) : !data.lines.length ? (
          <EmptyState icon={<ScrollText size={22} />} title={search.q || search.level ? "No matching lines" : "The log is empty"} description={search.q || search.level ? "Try a wider filter." : undefined} />
        ) : (
          <div className="min-w-max py-2 font-mono text-xs leading-5" role="log" aria-live={live ? "polite" : "off"}>
            {data.lines.map((l, i) => (
              <div key={i} className={cn("flex gap-4 px-5 hover:bg-surface-2", LEVEL_STYLE[l.level])}>
                <span className="w-32 shrink-0 text-fg-faint select-none">{lineTime(l.time)}</span>
                <span className="whitespace-pre">
                  {l.level !== "info" && <span className={cn("mr-2 font-semibold uppercase", l.level === "error" ? "text-danger" : "text-warning")}>{l.level === "warn" ? "warn" : "error"}</span>}
                  {l.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {data?.note && data.available && <div className="border-t bg-surface px-5 py-1.5 text-xs text-fg-muted">{data.note}</div>}
    </div>
  );
}
