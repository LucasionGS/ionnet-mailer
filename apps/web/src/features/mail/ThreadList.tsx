import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, CornerUpLeft, Mail, MailOpen, Paperclip, Star, Trash2 } from "lucide-react";
import type { ThreadSummary } from "@ionnet/shared";
import { avatarColor, cn, displayAddress, formatDateShort, initials } from "@/lib/utils";
import { Checkbox, Spinner, Tooltip } from "@/components/ui";

export interface ThreadListProps {
  threads: ThreadSummary[];
  activeId: string | undefined;
  focusedId: string | undefined;
  selected: Set<string>;
  onOpen: (t: ThreadSummary) => void;
  onToggleSelect: (t: ThreadSummary, shift: boolean) => void;
  onToggleStar: (t: ThreadSummary) => void;
  onToggleRead: (t: ThreadSummary) => void;
  onArchive?: (t: ThreadSummary) => void;
  onTrash: (t: ThreadSummary) => void;
  onDragStart: (t: ThreadSummary, e: React.DragEvent) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

type Row = { kind: "group"; label: string } | { kind: "thread"; thread: ThreadSummary } | { kind: "loader" };

function participantsLabel(t: ThreadSummary): string {
  const names = t.participants.map((p) => {
    const n = displayAddress(p);
    return n.includes("@") ? n.split("@")[0]! : n.split(" ")[0]!;
  });
  const uniq = [...new Set(names)];
  if (uniq.length === 1) return displayAddress(t.participants[0]);
  return uniq.slice(0, 3).join(", ") + (uniq.length > 3 ? ` +${uniq.length - 3}` : "");
}

/** Outlook-style buckets: the list is newest first, so labels only ever move towards "Older". */
function dateGroup(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Older";
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const weekday = (now.getDay() + 6) % 7; // Monday = 0
  if (days <= weekday) return "This week";
  if (days <= weekday + 7) return "Last week";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return "This month";
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "long" });
  return String(d.getFullYear());
}

function RowAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn("focus-ring flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg", danger && "hover:bg-danger-soft hover:text-danger")}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function ThreadList(p: ThreadListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const now = new Date();
    let last = "";
    for (const thread of p.threads) {
      const label = dateGroup(thread.date, now);
      if (label !== last) {
        out.push({ kind: "group", label });
        last = label;
      }
      out.push({ kind: "thread", thread });
    }
    if (p.hasNextPage) out.push({ kind: "loader" });
    return out;
  }, [p.threads, p.hasNextPage]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === "group" ? 30 : 76),
    getItemKey: (i) => {
      const r = rows[i]!;
      return r.kind === "thread" ? r.thread.id : r.kind === "group" ? `g:${r.label}:${i}` : "loader";
    },
    overscan: 8,
  });

  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1];
  useEffect(() => {
    if (!last) return;
    if (last.index >= rows.length - 2 && p.hasNextPage && !p.isFetchingNextPage) p.fetchNextPage();
  }, [last, rows.length, p]);

  // Keep the focused row visible
  useEffect(() => {
    if (!p.focusedId) return;
    const idx = rows.findIndex((r) => r.kind === "thread" && r.thread.id === p.focusedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusedId]);

  const selecting = p.selected.size > 0;

  return (
    <div ref={parentRef} className="scroll-thin h-full overflow-y-auto" role="grid" aria-label="Conversations">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const row = rows[vi.index]!;
          const style = { transform: `translateY(${vi.start}px)` };
          if (row.kind === "loader") {
            return (
              <div key={vi.key} className="absolute left-0 flex w-full items-center justify-center py-4 text-fg-muted" style={{ ...style, height: vi.size }}>
                <Spinner />
              </div>
            );
          }
          if (row.kind === "group") {
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 w-full border-b bg-surface-2/60 px-4 pt-2 pb-1 text-[11px] font-semibold text-fg-muted"
                style={style}
              >
                {row.label}
              </div>
            );
          }
          const t = row.thread;
          const active = t.id === p.activeId;
          const focused = t.id === p.focusedId;
          const checked = p.selected.has(t.id);
          const primary = t.participants[0];
          return (
            <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} className="absolute left-0 w-full" style={style}>
              <div
                role="row"
                aria-selected={active}
                tabIndex={-1}
                draggable
                onDragStart={(e) => p.onDragStart(t, e)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) p.onToggleSelect(t, e.shiftKey);
                  else p.onOpen(t);
                }}
                className={cn(
                  "group relative flex cursor-default items-start gap-3 border-b py-2.5 pr-3 pl-4 transition-colors duration-100 select-none",
                  active ? "bg-selected" : checked ? "bg-accent-soft" : "hover:bg-surface-2",
                  focused && "shadow-[inset_0_0_0_1px_var(--border-strong)]",
                )}
              >
                {t.unread && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
                <div className="relative mt-0.5 h-8 w-8 shrink-0">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white transition-opacity",
                      checked || selecting ? "opacity-0" : "group-hover:opacity-0",
                    )}
                    style={{ background: avatarColor(primary?.address ?? t.subject) }}
                  >
                    {initials(displayAddress(primary) || "?")}
                  </span>
                  <span className={cn("absolute inset-0 flex items-center justify-center transition-opacity", checked || selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                    <Checkbox checked={checked} onChange={() => p.onToggleSelect(t, false)} stopPropagation label="Select" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-sm", t.unread ? "font-semibold text-fg" : "text-fg")}>
                      {participantsLabel(t) || "(unknown)"}
                      {t.messageCount > 1 && <span className="ml-1.5 text-xs font-normal text-fg-faint tabular-nums">{t.messageCount}</span>}
                    </span>
                    <span className={cn("shrink-0 text-[11px] tabular-nums group-hover:invisible", t.unread ? "font-semibold text-accent" : "text-fg-faint")}>{formatDateShort(t.date)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {t.answered && <CornerUpLeft size={12} className="shrink-0 text-fg-faint" aria-label="Replied" />}
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", t.unread ? "font-semibold text-accent" : "text-fg-muted")}>{t.subject || "(no subject)"}</span>
                    {t.hasAttachments && <Paperclip size={12} className="shrink-0 text-fg-faint" />}
                    {t.flagged && <Star size={12} fill="currentColor" className="shrink-0 text-warning group-hover:invisible" />}
                  </div>
                  <div className="truncate text-xs text-fg-faint">{t.snippet || " "}</div>
                </div>
                {/* Quick actions take the place of the date while the pointer is over the row */}
                <div className={cn("absolute top-1.5 right-2 hidden items-center gap-0.5 rounded-md group-hover:flex", active ? "bg-selected" : checked ? "bg-accent-soft" : "bg-surface-2")}>
                  {p.onArchive && (
                    <RowAction label="Archive" onClick={() => p.onArchive?.(t)}>
                      <Archive size={15} />
                    </RowAction>
                  )}
                  <RowAction label="Delete" danger onClick={() => p.onTrash(t)}>
                    <Trash2 size={15} />
                  </RowAction>
                  <RowAction label={t.unread ? "Mark as read" : "Mark as unread"} onClick={() => p.onToggleRead(t)}>
                    {t.unread ? <MailOpen size={15} /> : <Mail size={15} />}
                  </RowAction>
                  <RowAction label={t.flagged ? "Unstar" : "Star"} onClick={() => p.onToggleStar(t)}>
                    <Star size={15} fill={t.flagged ? "currentColor" : "none"} className={t.flagged ? "text-warning" : ""} />
                  </RowAction>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
