import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Paperclip, Star } from "lucide-react";
import type { ThreadSummary } from "@ionnet/shared";
import { avatarColor, cn, displayAddress, formatDateShort, initials } from "@/lib/utils";
import { Checkbox } from "@/components/ui";
import { Spinner } from "@/components/ui";

export interface ThreadListProps {
  threads: ThreadSummary[];
  activeId: string | undefined;
  focusedId: string | undefined;
  selected: Set<string>;
  onOpen: (t: ThreadSummary) => void;
  onToggleSelect: (t: ThreadSummary, shift: boolean) => void;
  onToggleStar: (t: ThreadSummary) => void;
  onDragStart: (t: ThreadSummary, e: React.DragEvent) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

function participantsLabel(t: ThreadSummary): string {
  const names = t.participants.map((p) => {
    const n = displayAddress(p);
    return n.includes("@") ? n.split("@")[0]! : n.split(" ")[0]!;
  });
  const uniq = [...new Set(names)];
  return uniq.slice(0, 3).join(", ") + (uniq.length > 3 ? ` +${uniq.length - 3}` : "");
}

export function ThreadList(p: ThreadListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const count = p.threads.length + (p.hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1];
  useEffect(() => {
    if (!last) return;
    if (last.index >= p.threads.length - 1 && p.hasNextPage && !p.isFetchingNextPage) p.fetchNextPage();
  }, [last, p]);

  // Keep the focused row visible
  useEffect(() => {
    if (!p.focusedId) return;
    const idx = p.threads.findIndex((t) => t.id === p.focusedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [p.focusedId, p.threads, virtualizer]);

  return (
    <div ref={parentRef} className="scroll-thin h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const t = p.threads[vi.index];
          if (!t) {
            return (
              <div
                key="loader"
                className="absolute left-0 flex w-full items-center justify-center py-4 text-fg-muted"
                style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
              >
                <Spinner />
              </div>
            );
          }
          const active = t.id === p.activeId;
          const focused = t.id === p.focusedId;
          const checked = p.selected.has(t.id);
          const primary = t.participants[0];
          return (
            <div
              key={t.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full px-2"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <div
                role="row"
                tabIndex={-1}
                draggable
                onDragStart={(e) => p.onDragStart(t, e)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) p.onToggleSelect(t, e.shiftKey);
                  else p.onOpen(t);
                }}
                className={cn(
                  "group relative flex cursor-default items-start gap-3 rounded-lg border border-transparent px-2.5 py-2.5 transition-colors select-none",
                  active ? "bg-selected" : checked ? "bg-accent-soft/60" : "hover:bg-surface-2",
                  focused && !active && "border-border-strong",
                  focused && active && "border-accent/40",
                )}
              >
                <div className="relative mt-0.5 h-8 w-8 shrink-0">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white transition-opacity",
                      (checked || p.selected.size > 0) && "opacity-0",
                      "group-hover:opacity-0",
                    )}
                    style={{ background: avatarColor(primary?.address ?? t.subject) }}
                  >
                    {initials(displayAddress(primary) || "?")}
                  </span>
                  <span
                    className={cn(
                      "absolute inset-0 flex items-center justify-center transition-opacity",
                      checked || p.selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <Checkbox checked={checked} onChange={() => p.onToggleSelect(t, false)} stopPropagation label="Select" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-sm", t.unread ? "font-semibold text-fg" : "text-fg")}>
                      {participantsLabel(t) || "(unknown)"}
                      {t.messageCount > 1 && <span className="ml-1 text-xs font-normal text-fg-muted">{t.messageCount}</span>}
                    </span>
                    <span className={cn("shrink-0 text-[11px] tabular-nums", t.unread ? "font-semibold text-accent" : "text-fg-faint")}>
                      {formatDateShort(t.date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", t.unread ? "font-medium text-fg" : "text-fg-muted")}>
                      {t.subject || "(no subject)"}
                    </span>
                    {t.hasAttachments && <Paperclip size={12} className="shrink-0 text-fg-faint" />}
                  </div>
                  <div className="truncate text-xs text-fg-faint">{t.snippet}</div>
                </div>
                <button
                  type="button"
                  aria-label={t.flagged ? "Unstar" : "Star"}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onToggleStar(t);
                  }}
                  className={cn(
                    "absolute right-2 bottom-2 rounded p-0.5 transition-opacity",
                    t.flagged ? "text-warning opacity-100" : "text-fg-faint opacity-0 group-hover:opacity-100 hover:text-warning",
                  )}
                >
                  <Star size={14} fill={t.flagged ? "currentColor" : "none"} />
                </button>
                {t.unread && <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
