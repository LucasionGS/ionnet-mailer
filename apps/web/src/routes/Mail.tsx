import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Archive, FolderInput, Inbox, Mail, MailOpen, MailX, PanelLeft, Search, Star, Trash2, X } from "lucide-react";
import type { MessageRef, ThreadSummary } from "@ionnet/shared";
import { useFolders, useMe, useThreads } from "@/lib/queries";
import { cn, decodeFolder, encodeFolder } from "@/lib/utils";
import { Checkbox, EmptyState, ErrorState, IconButton, Input, Menu, MenuItem, MenuLabel, PageSpinner } from "@/components/ui";
import { FolderList } from "@/features/mail/FolderList";
import { ThreadList } from "@/features/mail/ThreadList";
import { ThreadView } from "@/features/mail/ThreadView";
import { useMailActions } from "@/features/mail/useMailActions";
import { isComposerOpen, openComposer } from "@/features/mail/composerStore";
import { newMessageInit } from "@/features/mail/compose";
import { useTheme } from "@/lib/theme";

function useIsDark() {
  const [theme] = useTheme();
  const [sys, setSys] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => setSys(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return theme === "dark" || (theme === "system" && sys);
}

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
  const dark = useIsDark();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | undefined>(threadId);
  const [searchText, setSearchText] = useState(q);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastToggled = useRef<string | null>(null);

  const list = useMemo(() => threads.data?.pages.flatMap((p) => p.threads) ?? [], [threads.data]);
  const total = threads.data?.pages[0]?.total ?? 0;
  const currentFolder = folders?.find((f) => f.path === folder);

  useEffect(() => {
    setSelected(new Set());
    setFocusedId(undefined);
  }, [folder, q]);
  useEffect(() => setSearchText(q), [q]);
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
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape" && e.target === searchRef.current) searchRef.current?.blur();
        return;
      }
      if (isComposerOpen() && document.querySelector('[role="dialog"][aria-label="Compose message"]')) return;
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
          if (me) openComposer(newMessageInit(me));
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
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

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void goFolder(searchText.trim() || undefined);
  };

  const allSelected = list.length > 0 && selected.size === list.length;
  const someSelected = selected.size > 0 && !allSelected;
  const moveTargets = (folders ?? []).filter((f) => f.path !== folder && f.specialUse !== "drafts");
  const showThreadPane = !!threadId;

  return (
    <div className="flex h-full">
      {/* Folder pane */}
      <aside
        className={cn(
          "w-56 shrink-0 border-r bg-surface max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-xl max-md:transition-transform",
          !foldersOpen && "max-md:-translate-x-full",
        )}
      >
        <div className="flex h-12 items-center justify-between border-b px-3">
          <span className="text-sm font-semibold">Mail</span>
          <IconButton label="Close" size="sm" className="md:hidden" onClick={() => setFoldersOpen(false)}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="h-[calc(100%-3rem)]" onClick={() => setFoldersOpen(false)}>
          {folders ? <FolderList folders={folders} activePath={folder} onDrop={onDropFolder} /> : <PageSpinner />}
        </div>
      </aside>
      {foldersOpen && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setFoldersOpen(false)} />}

      {/* Thread list pane */}
      <section className={cn("flex w-full min-w-0 flex-col border-r bg-surface md:w-[380px] md:shrink-0 lg:w-[420px]", showThreadPane && "max-md:hidden")}>
        <div className="flex h-12 items-center gap-1 border-b px-2">
          <IconButton label="Folders" className="md:hidden" onClick={() => setFoldersOpen(true)}>
            <PanelLeft size={16} />
          </IconButton>
          {selected.size > 0 ? (
            <div className="flex flex-1 items-center gap-1 animate-fade-in">
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={(v) => setSelected(v ? new Set(list.map((t) => t.id)) : new Set())} label="Select all" className="ml-2 mr-1" />
              <span className="mr-1 text-xs text-fg-muted">{selected.size}</span>
              <IconButton label="Archive (e)" onClick={bulk.archive}>
                <Archive size={16} />
              </IconButton>
              <IconButton label="Delete (#)" tone="danger" onClick={bulk.trash}>
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
              <div className="flex-1" />
              <IconButton label="Clear selection (Esc)" size="sm" onClick={() => setSelected(new Set())}>
                <X size={14} />
              </IconButton>
            </div>
          ) : (
            <form onSubmit={submitSearch} className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint" />
              <Input
                ref={searchRef}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={`Search ${currentFolder?.name ?? folder}  (/)`}
                className="h-8 border-transparent bg-surface-2 pl-8 focus:bg-surface"
              />
              {q && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-fg-faint hover:text-fg"
                  onClick={() => {
                    setSearchText("");
                    void goFolder(undefined);
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </form>
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-fg-faint">
          <span>
            {q ? `Results for “${q}”` : currentFolder?.name ?? folder}
            {total > 0 && ` · ${total}`}
          </span>
          {currentFolder && currentFolder.unread > 0 && <span>{currentFolder.unread} unread</span>}
        </div>
        <div className="min-h-0 flex-1">
          {threads.isLoading ? (
            <PageSpinner />
          ) : threads.error ? (
            <ErrorState error={threads.error} retry={() => threads.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={q ? <MailX size={22} /> : <Inbox size={22} />}
              title={q ? "No results" : currentFolder?.specialUse === "inbox" ? "Your inbox is empty" : "Nothing here"}
              description={q ? "Try different words or search another folder." : undefined}
            />
          ) : (
            <ThreadList
              threads={list}
              activeId={threadId}
              focusedId={focusedId}
              selected={selected}
              onOpen={openThread}
              onToggleSelect={toggleSelect}
              onToggleStar={(t) => actions.setFlagged(t.uids.map((uid) => ({ folder: t.folder, uid })), !t.flagged)}
              onDragStart={onDragStart}
              hasNextPage={!!threads.hasNextPage}
              isFetchingNextPage={threads.isFetchingNextPage}
              fetchNextPage={() => void threads.fetchNextPage()}
            />
          )}
        </div>
      </section>

      {/* Reading pane */}
      <section className={cn("min-w-0 flex-1 bg-bg", !showThreadPane && "max-md:hidden")}>
        {threadId && me ? (
          <ThreadShortcutBridge>
            <ThreadView folder={folder} threadId={threadId} me={me} dark={dark} onBack={closeThread} onClosed={closeThread} />
          </ThreadShortcutBridge>
        ) : (
          <div className="hidden h-full md:block">
            <EmptyState
              icon={<Mail size={22} />}
              title="Select a conversation"
              description={
                <span>
                  Press <kbd className="rounded border bg-surface px-1 font-mono">c</kbd> to compose, <kbd className="rounded border bg-surface px-1 font-mono">j</kbd>/
                  <kbd className="rounded border bg-surface px-1 font-mono">k</kbd> to move, <kbd className="rounded border bg-surface px-1 font-mono">/</kbd> to search.
                </span>
              }
            />
          </div>
        )}
      </section>
    </div>
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
