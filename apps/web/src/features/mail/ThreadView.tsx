import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, FolderInput, MailOpen, ShieldAlert, Star, Trash2 } from "lucide-react";
import type { Me, Message, MessageRef, Thread } from "@ionnet/shared";
import { useThread, qk } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, IconButton, Menu, MenuItem, MenuLabel, PageSpinner } from "@/components/ui";
import { MessageCard } from "./MessageCard";
import { useMailActions } from "./useMailActions";
import { openComposer } from "./composerStore";
import { draftInit, forwardInit, replyInit } from "./compose";

export function ThreadView({
  folder,
  threadId,
  me,
  dark,
  onBack,
  onClosed,
}: {
  folder: string;
  threadId: string;
  me: Me;
  dark: boolean;
  onBack?: () => void;
  onClosed: () => void;
}) {
  const { data, isLoading, error, refetch } = useThread(folder, threadId);
  const actions = useMailActions();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const messages = data?.messages ?? [];
  const refs: MessageRef[] = useMemo(() => messages.map((m) => ({ folder: m.folder, uid: m.uid })), [messages]);

  // Expand newest (and unread) messages when the thread loads; mark them read.
  useEffect(() => {
    if (!data) return;
    const set = new Set<number>();
    const last = data.messages[data.messages.length - 1];
    if (last) set.add(last.uid);
    for (const m of data.messages) if (m.unread) set.add(m.uid);
    setExpanded(set);
    const unread = data.messages.filter((m) => m.unread).map((m) => ({ folder: m.folder, uid: m.uid }));
    if (unread.length) {
      actions.markRead(unread, true);
      qc.setQueryData<Thread>(qk.thread(folder, threadId), { ...data, messages: data.messages.map((m) => ({ ...m, unread: false })) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const toggle = (uid: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

  const onReply = (m: Message) => openComposer(replyInit(m, me, false));
  const onReplyAll = (m: Message) => openComposer(replyInit(m, me, true));
  const onForward = (m: Message) => openComposer(forwardInit(m, me));
  const onEditDraft = (m: Message) => openComposer(draftInit(m));
  const onDelete = (m: Message) => {
    const inTrash = actions.folders?.find((f) => f.path === m.folder)?.specialUse === "trash";
    actions.trash([{ folder: m.folder, uid: m.uid }], inTrash);
    if (messages.length <= 1) onClosed();
  };
  const onToggleFlag = (m: Message) => {
    actions.setFlagged([{ folder: m.folder, uid: m.uid }], !m.flagged);
  };
  const onMarkUnread = (m: Message) => actions.markRead([{ folder: m.folder, uid: m.uid }], false);

  const currentFolder = actions.folders?.find((f) => f.path === folder);
  const allFlagged = messages.length > 0 && messages.every((m) => m.flagged);
  const moveTargets = (actions.folders ?? []).filter((f) => f.path !== folder && f.specialUse !== "drafts");

  if (isLoading) return <PageSpinner />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  if (!data || !messages.length) return <EmptyState title="This conversation is empty" description="It may have been moved or deleted." />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b bg-surface px-3 py-2">
        {onBack && (
          <IconButton label="Back" onClick={onBack} className="mr-1 md:hidden">
            <ArrowLeft size={16} />
          </IconButton>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{data.subject || "(no subject)"}</h2>
        <IconButton
          label="Archive (e)"
          onClick={() => {
            actions.archive(refs);
            onClosed();
          }}
          disabled={currentFolder?.specialUse === "archive"}
        >
          <Archive size={16} />
        </IconButton>
        <IconButton
          label={currentFolder?.specialUse === "trash" ? "Delete permanently (#)" : "Delete (#)"}
          tone="danger"
          onClick={() => {
            actions.trash(refs, currentFolder?.specialUse === "trash");
            onClosed();
          }}
        >
          <Trash2 size={16} />
        </IconButton>
        <IconButton label={allFlagged ? "Unstar (s)" : "Star (s)"} active={allFlagged} onClick={() => actions.setFlagged(refs, !allFlagged)}>
          <Star size={16} fill={allFlagged ? "currentColor" : "none"} className={allFlagged ? "text-warning" : ""} />
        </IconButton>
        <IconButton
          label="Mark as unread (u)"
          onClick={() => {
            actions.markRead(refs, false);
            onClosed();
          }}
        >
          <MailOpen size={16} />
        </IconButton>
        {currentFolder?.specialUse !== "junk" && (
          <IconButton
            label="Mark as spam"
            onClick={() => {
              actions.junk(refs);
              onClosed();
            }}
          >
            <ShieldAlert size={16} />
          </IconButton>
        )}
        <Menu
          trigger={
            <button type="button" aria-label="Move to" className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
              <FolderInput size={16} />
            </button>
          }
        >
          <MenuLabel>Move to</MenuLabel>
          {moveTargets.map((f) => (
            <MenuItem
              key={f.path}
              onSelect={() => {
                actions.moveTo(refs, f.path, f.name);
                onClosed();
              }}
            >
              {f.path}
            </MenuItem>
          ))}
        </Menu>
      </div>
      <div className={cn("scroll-thin flex-1 overflow-y-auto")}>
        <div className="mx-auto flex max-w-4xl flex-col gap-3 p-3 md:p-5">
          {messages.map((m) => (
            <MessageCard
              key={`${m.folder}:${m.uid}`}
              message={m}
              expanded={expanded.has(m.uid)}
              onToggle={() => toggle(m.uid)}
              dark={dark}
              onReply={onReply}
              onReplyAll={onReplyAll}
              onForward={onForward}
              onDelete={onDelete}
              onToggleFlag={onToggleFlag}
              onMarkUnread={onMarkUnread}
              onEditDraft={onEditDraft}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
