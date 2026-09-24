import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Archive, FolderInput, Inbox, Mail, MailOpen, MailX, PenLine, RotateCw, Star, Trash2, X } from "lucide-react";
import { formatBytes, type MessageRef, type ThreadSummary } from "@ionnet/shared";
import { useFolders, useMe, useQuota, useThreads } from "@/lib/queries";
import { cn, decodeFolder, encodeFolder } from "@/lib/utils";
import { Button, Checkbox, EmptyState, ErrorState, IconButton, Menu, MenuItem, MenuLabel } from "@/components/ui";
import { FolderList } from "@/features/mail/FolderList";
import { ThreadList } from "@/features/mail/ThreadList";
import { ThreadView } from "@/features/mail/ThreadView";
import { useMailActions } from "@/features/mail/useMailActions";
import { openComposer } from "@/features/mail/composerStore";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { SEARCH_INPUT_ID, setDrawerOpen, useDrawerOpen } from "@/lib/ui";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function MailPage() {
  const params = useParams({ strict: false }) as { folder: string; threadId?: string };
  const folder = decodeFolder(params.folder);
  const threadId = params.threadId;
  const search = useSearch({ strict: false }) as { q?: string };
  const q = search.q ?? "";
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: folders } = useFolders();
  const threads = useThreads(folder, q);
  const actions = useMailActions();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | undefined>(threadId);
  const prefs = usePrefs();
  const drawerOpen = useDrawerOpen();
  const lastToggled = useRef<string | null>(null);

  const list = useMemo(() => threads.data?.pages.flatMap((p) => p.threads) ?? [], [threads.data]);
  const total = threads.data?.pages[0]?.total ?? 0;
  const currentFolder = folders?.find((f) => f.path === folder);

  useEffect(() => {
    setSelected(new Set());
    setFocusedId(undefined);
  }, [folder, q]);
  useEffect(() => {
    if (threadId) setFocusedId(threadId);
  }, [threadId]);

  const goFolder = useCallback(
    (nextQ?: string) =>
      navigate({ to: "/mail/$folder", params: { folder: encodeFolder(folder) }, search: nextQ ? { q: nextQ } : {} }),
    [navigate, folder],
  );
  const openThread = useCallback(
    (t: ThreadSummary) => {
      setFocusedId(t.id);
      void navigate({ to: "/mail/$folder/$threadId", params: { folder: encodeFolder(folder), threadId: t.id }, search: q ? { q } : {} });
    },
    [navigate, folder, q],
  );
  const closeThread = useCallback(() => void goFolder(q), [goFolder, q]);

  const toggleSelect = useCallback(
    (t: ThreadSummary, shift: boolean) => {
      setSelected((s) => {
        const n = new Set(s);
        if (shift && lastToggled.current) {
          const a = list.findIndex((x) => x.id === lastToggled.current);
          const b = list.findIndex((x) => x.id === t.id);
          if (a >= 0 && b >= 0) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(list[i]!.id);
            return n;
          }
        }
        if (n.has(t.id)) n.delete(t.id);
        else n.add(t.id);
        lastToggled.current = t.id;
        return n;
      });
    },
    [list],
  );

  const refsOf = useCallback(
    (ids: Iterable<string>): MessageRef[] => {
      const set = new Set(ids);
      return list.filter((t) => set.has(t.id)).flatMap((t) => t.uids.map((uid) => ({ folder: t.folder, uid })));
    },
    [list],
  );

  const targetIds = useCallback((): string[] => {
    if (selected.size) return [...selected];
    const id = threadId ?? focusedId;
    return id ? [id] : [];
  }, [selected, threadId, focusedId]);

  const afterBulk = useCallback(
    (ids: string[]) => {
      setSelected(new Set());
      if (threadId && ids.includes(threadId)) closeThread();
    },
    [threadId, closeThread],
  );

  const bulk = {
    archive: () => {
      const ids = targetIds();
      actions.archive(refsOf(ids));
      afterBulk(ids);
    },
    trash: () => {
      const ids = targetIds();
      actions.trash(refsOf(ids), currentFolder?.specialUse === "trash");
      afterBulk(ids);
    },
    read: (read: boolean) => {
      const ids = targetIds();
      actions.markRead(refsOf(ids), read);
      setSelected(new Set());
    },
    star: () => {
      const ids = targetIds();
      const all = list.filter((t) => ids.includes(t.id)).every((t) => t.flagged);
      actions.setFlagged(refsOf(ids), !all);
      setSelected(new Set());
    },
    move: (dest: string, label: string) => {
      const ids = targetIds();
      actions.moveTo(refsOf(ids), dest, label);
      afterBulk(ids);
    },
  };

  // Drag & drop threads onto folders
  const dragIds = useRef<string[]>([]);
  const onDragStart = (t: ThreadSummary, e: React.DragEvent) => {
    const ids = selected.has(t.id) ? [...selected] : [t.id];
    dragIds.current = ids;
    e.dataTransfer.setData("application/x-ionnet-messages", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDropFolder = (path: string) => {
    if (!dragIds.current.length || path === folder) return;
    const ids = dragIds.current;
    dragIds.current = [];
    actions.moveTo(refsOf(ids), path, folders?.find((f) => f.path === path)?.name);
    afterBulk(ids);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="menu"]')) return;
      const idx = focusedId ? list.findIndex((t) => t.id === focusedId) : -1;
      const focus = (i: number) => {
        const t = list[Math.max(0, Math.min(list.length - 1, i))];
        if (t) {
          setFocusedId(t.id);
          if (threadId) openThread(t);
        }
      };
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          focus(idx + 1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          focus(idx - 1);
          break;
        case "o":
        case "Enter": {
          const t = list.find((x) => x.id === focusedId);
          if (t) openThread(t);
          break;
        }
        case "x": {
          const t = list.find((x) => x.id === focusedId);
          if (t) toggleSelect(t, false);
          break;
        }
        case "e":
          bulk.archive();
          break;
        case "#":
          bulk.trash();
          break;
        case "u":
          bulk.read(false);
          break;
        case "s":
          bulk.star();
          break;
        case "c":
          e.preventDefault();
          openComposer();
          break;
        case "/":
          e.preventDefault();
          document.getElementById(SEARCH_INPUT_ID)?.focus();
          break;
        case "Escape":
          if (selected.size) setSelected(new Set());
          else if (threadId) closeThread();
          break;
        case "r":
        case "a":
        case "f": {
          // handled by ThreadView via message buttons; trigger on the newest message through a custom event
          if (threadId) window.dispatchEvent(new CustomEvent("ionnet:thread-shortcut", { detail: e.key }));
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, focusedId, threadId, selected, me, openThread, toggleSelect, closeThread]);

  const allSelected = list.length > 0 && selected.size === list.length;
  const someSelected = selected.size > 0 && !allSelected;
  const moveTargets = (folders ?? []).filter((f) => f.path !== folder && f.specialUse !== "drafts");
  const showThreadPane = !!threadId;
  const refsFor = (t: ThreadSummary): MessageRef[] => t.uids.map((uid) => ({ folder: t.folder, uid }));
  const inTrash = currentFolder?.specialUse === "trash";
  const folderTitle = currentFolder?.name ?? folder;

  return (
    <div className="flex h-full">
      {/* Folder pane */}
      <aside
        className={cn(
          "flex w-60 shrink-0 flex-col max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-72 max-md:bg-surface max-md:shadow-float max-md:transition-transform max-md:duration-200",
          !drawerOpen && "max-md:-translate-x-full",
          prefs.foldersCollapsed && "md:hidden",
        )}
      >
        <div className="flex items-center gap-2 px-3 pt-1 pb-3 max-md:pt-3">
          <Button variant="primary" size="lg" className="h-11 flex-1 justify-start gap-2.5 rounded-xl px-4 shadow-sm" onClick={() => (setDrawerOpen(false), openComposer())}>
            <PenLine size={16} /> New mail
          </Button>
          <IconButton label="Close" className="md:hidden" onClick={() => setDrawerOpen(false)}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1" onClick={() => setDrawerOpen(false)}>
          {folders ? <FolderList folders={folders} activePath={folder} onDrop={onDropFolder} /> : <FolderSkeleton />}
        </div>
        <StorageMeter />
      </aside>
      {drawerOpen && <div className="animate-overlay-in fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setDrawerOpen(false)} />}

      <div className="flex min-w-0 flex-1 overflow-hidden border-t bg-surface md:rounded-tl-xl md:border-l">
        {/* Conversation list */}
        <section
          className={cn("relative flex w-full min-w-0 flex-col md:w-(--list-w) md:shrink-0 md:border-r", showThreadPane && "max-md:hidden")}
          style={{ "--list-w": `${prefs.listWidth}px` } as React.CSSProperties}
        >
          <div className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-4">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={(v) => setSelected(v ? new Set(list.map((t) => t.id)) : new Set())}
              label="Select all"
              className="mr-2"
            />
            {selected.size > 0 ? (
              <div className="flex min-w-0 flex-1 items-center gap-0.5 animate-fade-in">
                <span className="mr-1 text-sm font-medium tabular-nums">{selected.size} selected</span>
                <div className="flex-1" />
                <IconButton label="Archive (e)" onClick={bulk.archive}>
                  <Archive size={16} />
                </IconButton>
                <IconButton label={inTrash ? "Delete permanently (#)" : "Delete (#)"} tone="danger" onClick={bulk.trash}>
                  <Trash2 size={16} />
                </IconButton>
                <IconButton label="Mark as read" onClick={() => bulk.read(true)}>
                  <MailOpen size={16} />
                </IconButton>
                <IconButton label="Mark as unread (u)" onClick={() => bulk.read(false)}>
                  <Mail size={16} />
                </IconButton>
                <IconButton label="Star (s)" onClick={bulk.star}>
                  <Star size={16} />
                </IconButton>
                <Menu
                  trigger={
                    <button type="button" aria-label="Move to" className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
                      <FolderInput size={16} />
                    </button>
                  }
                >
                  <MenuLabel>Move to</MenuLabel>
                  {moveTargets.map((f) => (
                    <MenuItem key={f.path} onSelect={() => bulk.move(f.path, f.name)}>
                      {f.path}
                    </MenuItem>
                  ))}
                </Menu>
              </div>
            ) : (
              <>
                <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{q ? `Results for “${q}”` : folderTitle}</h1>
                <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                  {!q && currentFolder && currentFolder.unread > 0 ? `${currentFolder.unread} unread` : total > 0 ? `${total}` : ""}
                </span>
                <IconButton label="Refresh" className="ml-1" onClick={() => void threads.refetch()}>
                  <RotateCw size={15} className={cn(threads.isRefetching && "animate-[spin_700ms_linear_infinite]")} />
                </IconButton>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {threads.isLoading ? (
              <ThreadListSkeleton />
            ) : threads.error ? (
              <ErrorState error={threads.error} retry={() => threads.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={q ? <MailX size={22} /> : <Inbox size={22} />}
                title={q ? "Nothing matches that search" : currentFolder?.specialUse === "inbox" ? "You're all caught up" : `Nothing in ${folderTitle}`}
                description={q ? "Try different words, or search another folder." : undefined}
              />
            ) : (
              <ThreadList
                threads={list}
                activeId={threadId}
                focusedId={focusedId}
                selected={selected}
                onOpen={openThread}
                onToggleSelect={toggleSelect}
                onToggleStar={(t) => actions.setFlagged(refsFor(t), !t.flagged)}
                onToggleRead={(t) => actions.markRead(refsFor(t), t.unread)}
                onArchive={
                  currentFolder?.specialUse === "archive"
                    ? undefined
                    : (t) => {
                        actions.archive(refsFor(t));
                        afterBulk([t.id]);
                      }
                }
                onTrash={(t) => {
                  actions.trash(refsFor(t), inTrash);
                  afterBulk([t.id]);
                }}
                onDragStart={onDragStart}
                hasNextPage={!!threads.hasNextPage}
                isFetchingNextPage={threads.isFetchingNextPage}
                fetchNextPage={() => void threads.fetchNextPage()}
              />
            )}
          </div>
          <ResizeHandle width={prefs.listWidth} onResize={(w) => setPrefs({ listWidth: w })} />
        </section>

        {/* Reading pane */}
        <section className={cn("min-w-0 flex-1", !showThreadPane && "max-md:hidden")}>
          {threadId && me ? (
            <ThreadShortcutBridge>
              <ThreadView key={threadId} folder={folder} threadId={threadId} me={me} onBack={closeThread} onClosed={closeThread} />
            </ThreadShortcutBridge>
          ) : (
            <div className="hidden h-full md:block">
              <EmptyState
                icon={<MailOpen size={22} />}
                title={selected.size > 1 ? `${selected.size} conversations selected` : "Select a conversation to read"}
                description={
                  <span className="leading-6">
                    <Kbd>c</Kbd> new mail · <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>e</Kbd> archive · <Kbd>/</Kbd> search
                  </span>
                }
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{children}</kbd>;

function ThreadListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex gap-3 border-b px-4 py-3" style={{ opacity: 1 - i * 0.09 }}>
          <div className="skeleton h-8 w-8 shrink-0 !rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <div className="flex justify-between gap-6">
              <div className="skeleton h-3" style={{ width: `${30 + ((i * 17) % 30)}%` }} />
              <div className="skeleton h-3 w-10" />
            </div>
            <div className="skeleton h-3" style={{ width: `${55 + ((i * 23) % 35)}%` }} />
            <div className="skeleton h-2.5 w-4/5 opacity-60" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FolderSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 px-5 py-3">
      {[60, 45, 50, 70, 40].map((w, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function StorageMeter() {
  const { data: quota } = useQuota();
  if (!quota || quota.limitBytes <= 0) return null;
  const pct = Math.min(100, Math.round((quota.usedBytes / quota.limitBytes) * 100));
  return (
    <div className="px-5 pt-2 pb-4">
      <div className="h-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cn("h-full rounded-full transition-[width] duration-500", pct > 90 ? "bg-danger" : pct > 75 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] text-fg-faint">
        {formatBytes(quota.usedBytes)} of {formatBytes(quota.limitBytes)} used
      </div>
    </div>
  );
}

/** Drag the edge of the conversation list to make it wider or narrower; double-click to reset. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const [active, setActive] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize conversation list"
      onDoubleClick={() => onResize(400)}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        setActive(true);
        const move = (ev: PointerEvent) => onResize(Math.max(300, Math.min(640, width + ev.clientX - startX)));
        const up = () => {
          setActive(false);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.removeProperty("cursor");
          document.body.style.removeProperty("user-select");
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className={cn("absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize max-md:hidden", "after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-accent/50", active && "after:bg-accent")}
    />
  );
}

/** Routes r/a/f keyboard shortcuts to the newest message's reply/forward buttons. */
function ThreadShortcutBridge({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      const label = key === "r" ? "Reply (r)" : key === "a" ? "Reply all (a)" : "Forward (f)";
      const buttons = ref.current?.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`);
      buttons?.[buttons.length - 1]?.click();
    };
    window.addEventListener("ionnet:thread-shortcut", h);
    return () => window.removeEventListener("ionnet:thread-shortcut", h);
  }, []);
  return (
    <div ref={ref} className="h-full">
      {children}
    </div>
  );
}
