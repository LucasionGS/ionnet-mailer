import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, FolderInput, Forward, Mail, PenLine, Reply, ReplyAll, ShieldAlert, Star, Trash2 } from "lucide-react";
import type { Me, Message, MessageRef, Thread } from "@ionnet/shared";
import { useThread, qk } from "@/lib/queries";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Menu, MenuItem, MenuLabel } from "@/components/ui";
import { MessageCard } from "./MessageCard";
import { useMailActions } from "./useMailActions";
import { openComposer, useComposer, type ComposerInit } from "./composerStore";
import { Composer } from "./Composer";
import { draftInit, forwardInit, replyInit } from "./compose";

export function ThreadView({
  folder,
  threadId,
  me,
  onBack,
  onClosed,
}: {
  folder: string;
  threadId: string;
  me: Me;
  onBack?: () => void;
  onClosed: () => void;
}) {
  const { data, isLoading, error, refetch } = useThread(folder, threadId);
  const actions = useMailActions();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const messages = data?.messages ?? [];
  const refs: MessageRef[] = useMemo(() => messages.map((m) => ({ folder: m.folder, uid: m.uid })), [messages]);

  // Expand the newest and the unread messages, and mark them read: when the thread loads, and again for messages
  // that arrive while it is open (a reply coming in), without collapsing what the reader opened or closed.
  const seenUids = useRef<Set<number>>(new Set());
  const messageKey = data?.messages.map((m) => `${m.folder}:${m.uid}`).join(",");
  useEffect(() => {
    if (!data) return;
    const fresh = data.messages.filter((m) => !seenUids.current.has(m.uid));
    if (!fresh.length) return;
    const last = data.messages[data.messages.length - 1];
    setExpanded((s) => {
      const set = new Set(s);
      if (last && fresh.includes(last)) set.add(last.uid);
      for (const m of fresh) if (m.unread) set.add(m.uid);
      return set;
    });
    for (const m of fresh) seenUids.current.add(m.uid);
    const unread = fresh.filter((m) => m.unread).map((m) => ({ folder: m.folder, uid: m.uid }));
    if (unread.length) {
      actions.markRead(unread, true);
      const ids = new Set(unread.map((r) => r.uid));
      qc.setQueryData<Thread>(qk.thread(folder, threadId), { ...data, messages: data.messages.map((m) => (ids.has(m.uid) ? { ...m, unread: false } : m)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageKey]);

  const toggle = (uid: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

  // Replies are written right below the conversation they belong to.
  const composer = useComposer();
  const inlineComposer = composer?.placement === "inline" && composer.thread?.id === threadId && composer.thread.folder === folder ? composer : null;
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inlineComposer) composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [inlineComposer?.key]);

  const openInline = (init: ComposerInit) => openComposer({ ...init, placement: "inline", thread: { folder, id: threadId } });
  const onReply = (m: Message) => openInline(replyInit(m, me, false));
  const onReplyAll = (m: Message) => openInline(replyInit(m, me, true));
  const onForward = (m: Message) => openInline(forwardInit(m, me));
  const onEditDraft = (m: Message) => openComposer(draftInit(m, me));
  // Deleting from Trash is permanent, so it asks first.
  const [purge, setPurge] = useState<{ refs: MessageRef[]; closes: boolean } | null>(null);
  const deleteRefs = (target: MessageRef[], closes: boolean) => {
    const inTrash = target.length > 0 && actions.folders?.find((f) => f.path === target[0]!.folder)?.specialUse === "trash";
    if (inTrash) {
      setPurge({ refs: target, closes });
      return;
    }
    actions.trash(target);
    if (closes) onClosed();
  };
  const onDelete = (m: Message) => deleteRefs([{ folder: m.folder, uid: m.uid }], messages.length <= 1);
  const onToggleFlag = (m: Message) => {
    actions.setFlagged([{ folder: m.folder, uid: m.uid }], !m.flagged);
  };
  const onMarkUnread = (m: Message) => actions.markRead([{ folder: m.folder, uid: m.uid }], false);

  const currentFolder = actions.folders?.find((f) => f.path === folder);
  const allFlagged = messages.length > 0 && messages.every((m) => m.flagged);
  const moveTargets = (actions.folders ?? []).filter((f) => f.path !== folder && f.specialUse !== "drafts");

  if (isLoading) return <ThreadSkeleton />;
  // The conversation left this folder (moved, deleted, or a draft that was sent) while it was open.
  const gone = (isApiError(error) && error.status === 404) || (!error && (!data || !messages.length));
  if (gone) {
    return (
      <EmptyState
        icon={<Mail size={22} />}
        title="This conversation is no longer here"
        description="It was moved or deleted, here or in another mail app."
        action={
          <Button variant="outline" size="sm" onClick={onClosed}>
            Back to the list
          </Button>
        }
      />
    );
  }
  if (error || !data) return <ErrorState error={error} retry={() => refetch()} />;

  const newest = messages[messages.length - 1]!;
  const canReplyAll = newest.to.length + newest.cc.length > 1;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b px-2">
        {onBack && (
          <IconButton label="Back" onClick={onBack} className="mr-1 md:hidden">
            <ArrowLeft size={16} />
          </IconButton>
        )}
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
          onClick={() => deleteRefs(refs, true)}
        >
          <Trash2 size={16} />
        </IconButton>
        {currentFolder?.specialUse !== "junk" && (
          <IconButton
            label="Mark as spam"
            onClick={() => {
              if (actions.junk(refs)) onClosed();
            }}
          >
            <ShieldAlert size={16} />
          </IconButton>
        )}
        <span className="mx-1.5 h-5 w-px bg-border" />
        <IconButton
          label="Mark as unread (u)"
          onClick={() => {
            actions.markRead(refs, false);
            onClosed();
          }}
        >
          <Mail size={16} />
        </IconButton>
        <Menu
          align="start"
          trigger={
            <button type="button" aria-label="Move to" title="Move to" className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
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
        <div className="mx-auto flex max-w-4xl flex-col px-4 pb-10 md:px-8">
          <div className="flex items-start gap-2 pt-5 pb-3">
            <h2 className="min-w-0 flex-1 text-xl leading-snug font-semibold tracking-tight break-words">{data.subject || "(no subject)"}</h2>
            <IconButton label={allFlagged ? "Unstar (s)" : "Star (s)"} onClick={() => actions.setFlagged(refs, !allFlagged)}>
              <Star size={17} fill={allFlagged ? "currentColor" : "none"} className={allFlagged ? "text-warning" : ""} />
            </IconButton>
          </div>
          <div className="flex flex-col divide-y">
            {messages.map((m) => (
              <MessageCard
                key={`${m.folder}:${m.uid}`}
                message={m}
                expanded={expanded.has(m.uid)}
                onToggle={() => toggle(m.uid)}
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
          <div ref={composerRef} className="scroll-mb-6 pt-5">
            {inlineComposer ? (
              <Composer key={inlineComposer.key} state={inlineComposer} me={me} variant="inline" />
            ) : newest.draft ? (
              <Button variant="primary" className="rounded-full px-4" onClick={() => onEditDraft(newest)}>
                <PenLine size={15} /> Edit draft
              </Button>
            ) : (
              (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="rounded-full px-4" onClick={() => onReply(newest)}>
                    <Reply size={15} /> Reply
                  </Button>
                  {canReplyAll && (
                    <Button variant="outline" className="rounded-full px-4" onClick={() => onReplyAll(newest)}>
                      <ReplyAll size={15} /> Reply all
                    </Button>
                  )}
                  <Button variant="outline" className="rounded-full px-4" onClick={() => onForward(newest)}>
                    <Forward size={15} /> Forward
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!purge}
        onOpenChange={(o) => !o && setPurge(null)}
        title="Delete permanently?"
        description="The message is removed from the server for good. This can't be undone."
        confirmLabel="Delete permanently"
        danger
        onConfirm={() => {
          if (purge) {
            actions.trash(purge.refs, true);
            if (purge.closes) onClosed();
          }
          setPurge(null);
        }}
      />
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div aria-hidden className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pt-[4.25rem] md:px-8">
      <div className="skeleton h-6 w-3/5" />
      <div className="flex items-center gap-3">
        <div className="skeleton h-9 w-9 !rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="skeleton h-3 w-40" />
          <div className="skeleton h-2.5 w-24 opacity-60" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5 pt-2">
        {[92, 100, 85, 96, 60].map((w, i) => (
          <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
