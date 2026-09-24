import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CornerUpLeft, CornerUpRight, FileText, Maximize2, Minimize2, Minus, MoreHorizontal, Paperclip, PictureInPicture2, Send, Trash2, X } from "lucide-react";
import type { DraftRequest, Me, SendRequest } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { errorMessage, saveDraft } from "@/lib/api";
import { invalidateMail } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button, Checkbox, ConfirmDialog, IconButton, Tooltip } from "@/components/ui";
import { closeComposer, getComposer, registerComposerFlush, updateComposer, type ComposerState, type Recipient } from "./composerStore";
import { RecipientInput } from "./RecipientInput";
import { EditorArea, EditorToolbar, insertImages, useMailEditor } from "./Editor";
import { HtmlFrame } from "./HtmlFrame";
import { withSignature } from "./compose";
import { embedServerImages } from "./images";
import { queueSend } from "./pendingSend";

const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_HTML = 4_800_000;
const AUTOSAVE_MS = 4000;
const MENTIONS_ATTACHMENT = /\b(attach(ed|ment|ments|ing)?|enclosed|bijlage|bijgevoegd|im anhang|angehängt)\b/i;

function stripHtml(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").trim();
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function DraftStatus({ saving, savedAt, failed }: { saving: boolean; savedAt: number | null; failed: boolean }) {
  const now = useNow(20_000);
  if (saving) return <span className="text-[11px] text-fg-faint">Saving…</span>;
  if (failed) return <span className="text-[11px] text-danger">Draft not saved</span>;
  if (!savedAt) return null;
  const mins = Math.floor((now - savedAt) / 60_000);
  return (
    <span className="flex items-center gap-1 text-[11px] text-fg-faint">
      <Check size={11} />
      {mins < 1 ? "Draft saved" : `Saved ${mins}m ago`}
    </span>
  );
}

function FileChip({ name, size, file, onRemove }: { name: string; size: number; file?: File; onRemove: () => void }) {
  const isImage = file?.type.startsWith("image/");
  const thumb = useMemo(() => (file && isImage ? URL.createObjectURL(file) : null), [file, isImage]);
  useEffect(() => () => void (thumb && URL.revokeObjectURL(thumb)), [thumb]);
  return (
    <span className="group flex max-w-[240px] items-center gap-2 rounded-md border bg-surface py-1 pr-1 pl-1 text-xs">
      {thumb ? (
        <img src={thumb} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-2 text-fg-muted">{file ? <Paperclip size={13} /> : <FileText size={13} />}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="block text-[11px] leading-tight text-fg-faint">{formatBytes(size)}</span>
      </span>
      <button type="button" aria-label={`Remove ${name}`} className="focus-ring rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={onRemove}>
        <X size={12} />
      </button>
    </span>
  );
}

export function Composer({ state, me, variant }: { state: ComposerState; me: Me; variant: "dock" | "inline" }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<Recipient[]>(state.to);
  const [cc, setCc] = useState<Recipient[]>(state.cc);
  const [bcc, setBcc] = useState<Recipient[]>(state.bcc);
  const [showCc, setShowCc] = useState(state.cc.length > 0);
  const [showBcc, setShowBcc] = useState(state.bcc.length > 0);
  const [subject, setSubject] = useState(state.subject);
  const [files, setFiles] = useState<File[]>(state.files);
  const [forwardAtt, setForwardAtt] = useState(state.forwardAttachments);
  const [includeSignature, setIncludeSignature] = useState(state.signature);
  const [fromAddress, setFromAddress] = useState(state.fromAddress ?? me.email);
  const [quote, setQuote] = useState(state.quote);
  const signature = includeSignature ? me.signature : null;
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [ask, setAsk] = useState<{ title: string; description: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const lastSaved = useRef<string>("");
  const htmlRef = useRef(state.html);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** set once the message is sent or thrown away, so unmounting doesn't save it as a draft again */
  const finished = useRef(false);
  const identities = me.sendAs?.length ? me.sendAs : [me.email];

  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0) + forwardAtt.reduce((s, a) => s + a.size, 0), [files, forwardAtt]);

  const addFiles = useCallback((list: FileList | File[]) => {
    setFiles((current) => {
      const next = [...current];
      let size = next.reduce((s, f) => s + f.size, 0);
      for (const f of Array.from(list)) {
        if (size + f.size > MAX_TOTAL) {
          toast.error("Attachment too large", `Attachments can add up to ${formatBytes(MAX_TOTAL)}.`);
          break;
        }
        size += f.size;
        next.push(f);
      }
      return next;
    });
  }, []);

  const sendRef = useRef<() => void>(() => undefined);
  const editor = useMailEditor(
    state.html,
    (html) => {
      htmlRef.current = html;
      scheduleSave();
    },
    { onSubmit: () => sendRef.current(), onFiles: addFiles },
  );

  useEffect(() => {
    if (!editor) return;
    const replying = state.mode === "reply" || state.mode === "replyAll" || (state.mode === "draft" && to.length > 0);
    if (replying) editor.commands.focus("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  /** Everything the message consists of right now. Kept in a ref so timers and unmount see the latest values. */
  const current = { to, cc, bcc, subject, signature, files, forwardAtt, fromAddress, quote, includeSignature };
  const latest = useRef(current);
  latest.current = current;

  const snapshot = () => {
    const c = latest.current;
    return JSON.stringify({ ...c, html: htmlRef.current, files: c.files.map((f) => f.name + f.size) });
  };

  const isEmpty = () => {
    const c = latest.current;
    return !c.to.length && !c.cc.length && !c.bcc.length && !c.subject.trim() && !stripHtml(htmlRef.current) && !htmlRef.current.includes("<img") && !c.files.length;
  };

  const buildPayload = async () => {
    const c = latest.current;
    const body = await embedServerImages(htmlRef.current + c.quote);
    return {
      to: c.to,
      cc: c.cc,
      bcc: c.bcc,
      subject: c.subject,
      html: c.signature ? withSignature(body, c.signature) : body,
      fromName: me.displayName,
      fromAddress: c.fromAddress,
      inReplyTo: state.inReplyTo,
      replyMode: state.replyMode,
      forwardAttachments: c.forwardAtt.map((a) => ({ ref: a.ref, partId: a.partId })),
      requestReadReceipt: false,
    };
  };

  /** Resolves false when the save failed. */
  const doSaveDraft = async (silent = true): Promise<boolean> => {
    const snap = snapshot();
    if (snap === lastSaved.current || isEmpty()) return true;
    setSaving(true);
    try {
      const open = getComposer();
      const draftUid = open?.key === state.key ? open.draftUid : state.draftUid;
      const body: DraftRequest = { ...(await buildPayload()), draftUid };
      const r = await saveDraft(body, latest.current.files);
      updateComposer({ draftUid: r.uid }, state.key);
      lastSaved.current = snap;
      setSavedAt(Date.now());
      setSaveFailed(false);
      invalidateMail(qc);
      if (!silent) toast.success("Draft saved");
      return true;
    } catch (err) {
      setSaveFailed(true);
      if (!silent) toast.error("Could not save draft", errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(doSaveDraft);
  saveRef.current = doSaveDraft;

  const scheduleSave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(true), AUTOSAVE_MS);
  };

  // The first run records what we started with, so opening a reply doesn't immediately save an untouched draft.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      lastSaved.current = snapshot();
      return;
    }
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, signature, files, forwardAtt, fromAddress, quote]);

  // Leaving this component means one of two things: the composer moved between the conversation and the docked
  // window (keep its contents in the store for the next mount), or it was closed/replaced (keep a draft).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const c = latest.current;
      if (getComposer()?.key === state.key) {
        updateComposer(
          { to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, html: htmlRef.current, quote: c.quote, files: c.files, forwardAttachments: c.forwardAtt, signature: c.includeSignature, fromAddress: c.fromAddress },
          state.key,
        );
      } else if (!finished.current) {
        void saveRef.current(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const close = async () => {
    if (timer.current) clearTimeout(timer.current);
    await doSaveDraft(true);
    finished.current = true;
    closeComposer(state.key);
  };

  // Switching or adding an account reloads the app, so the composer is saved to Drafts and closed first.
  useEffect(
    () =>
      registerComposerFlush(async () => {
        if (timer.current) clearTimeout(timer.current);
        if (!(await saveRef.current(true))) return false;
        finished.current = true;
        closeComposer(state.key);
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const discard = () => {
    if (timer.current) clearTimeout(timer.current);
    finished.current = true;
    closeComposer(state.key);
    // A draft that already exists on the server stays in Drafts; the user can delete it there.
  };

  const deliver = async () => {
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      const open = getComposer();
      const body: SendRequest = { ...(await buildPayload()), draftUid: open?.key === state.key ? open.draftUid : state.draftUid };
      if (body.html.length > MAX_HTML) {
        toast.error("Message is too large", "Remove some inline images or add them as attachments instead.");
        setSending(false);
        return;
      }
      const c = latest.current;
      finished.current = true;
      closeComposer(state.key);
      queueSend(qc, body, c.files, {
        ...state,
        to: c.to,
        cc: c.cc,
        bcc: c.bcc,
        subject: c.subject,
        html: htmlRef.current,
        quote: c.quote,
        files: c.files,
        forwardAttachments: c.forwardAtt,
        signature: c.includeSignature,
        fromAddress: c.fromAddress,
        draftUid: body.draftUid,
      });
    } catch (err) {
      toast.error("Could not send", errorMessage(err));
      setSending(false);
    }
  };

  const send = async () => {
    if (sending) return;
    // A half-typed address only becomes a recipient when its field loses focus.
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r));
    const c = latest.current;
    if (!c.to.length && !c.cc.length && !c.bcc.length) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!c.to.length) {
      toast.error("Add someone to the To field");
      return;
    }
    const forgotFile = !c.files.length && !c.forwardAtt.length && MENTIONS_ATTACHMENT.test(stripHtml(htmlRef.current));
    const checks: Array<NonNullable<typeof ask>> = [];
    if (!c.subject.trim()) checks.push({ title: "Send without a subject?", description: "This message has no subject line.", confirmLabel: "Send anyway", onConfirm: () => undefined });
    if (forgotFile) checks.push({ title: "Forgot the attachment?", description: "Your message mentions an attachment, but nothing is attached.", confirmLabel: "Send anyway", onConfirm: () => undefined });
    const next = (i: number) => {
      const check = checks[i];
      if (!check) return void deliver();
      setAsk({ ...check, onConfirm: () => (setAsk(null), next(i + 1)) });
    };
    next(0);
  };
  sendRef.current = () => void send();

  const showQuote = () => {
    if (!editor || !quote) return;
    editor.chain().focus("end").insertContentAt(editor.state.doc.content.size, `<p></p>${quote}`).run();
    setQuote("");
  };

  const hasContent = !isEmpty();
  const modeLabel = state.mode === "forward" ? "Forward" : state.mode === "new" || state.mode === "draft" ? "New message" : "Reply";
  const title = subject.trim() || modeLabel;
  const inline = variant === "inline";
  const showSubject = !inline || state.mode === "forward" || state.mode === "new" || state.mode === "draft";

  if (!inline && state.minimized) {
    return (
      <div className="fixed right-6 bottom-0 z-40 flex w-72 items-center gap-1 rounded-t-lg border border-b-0 bg-surface py-1.5 pr-1.5 pl-3 shadow-float max-md:bottom-14">
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => updateComposer({ minimized: false }, state.key)}>
          {title}
        </button>
        <IconButton label="Open" size="sm" onClick={() => updateComposer({ minimized: false }, state.key)}>
          <Maximize2 size={13} />
        </IconButton>
        <IconButton label="Save and close" size="sm" onClick={() => void close()}>
          <X size={14} />
        </IconButton>
      </div>
    );
  }

  const fields = (
    <>
      {identities.length > 1 && (
        <div className="flex items-center gap-2 border-b px-4 py-1">
          <span className="w-10 shrink-0 text-xs text-fg-muted">From</span>
          <select
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            className="focus-ring -ml-1 h-7 min-w-0 rounded-md bg-transparent px-1 text-sm hover:bg-surface-2"
            aria-label="Send from"
          >
            {identities.map((a) => (
              <option key={a} value={a}>
                {me.displayName ? `${me.displayName} <${a}>` : a}
              </option>
            ))}
          </select>
        </div>
      )}
      <RecipientInput
        label="To"
        value={to}
        onChange={setTo}
        autoFocus={!to.length}
        extra={
          <div className="flex shrink-0 gap-0.5 pt-0.5 text-xs text-fg-muted">
            {!showCc && (
              <button type="button" className="focus-ring rounded px-1.5 py-1 hover:bg-surface-2 hover:text-fg" onClick={() => setShowCc(true)}>
                Cc
              </button>
            )}
            {!showBcc && (
              <button type="button" className="focus-ring rounded px-1.5 py-1 hover:bg-surface-2 hover:text-fg" onClick={() => setShowBcc(true)}>
                Bcc
              </button>
            )}
          </div>
        }
      />
      {showCc && <RecipientInput label="Cc" value={cc} onChange={setCc} autoFocus={!cc.length} />}
      {showBcc && <RecipientInput label="Bcc" value={bcc} onChange={setBcc} autoFocus={!bcc.length} />}
      {showSubject && (
        <div className="border-b px-4">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="h-10 w-full bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-fg-faint"
          />
        </div>
      )}
    </>
  );

  const body = (
    <>
      <div className={cn("relative flex min-h-0 flex-1 flex-col", inline && "max-h-[55vh] min-h-36")}>
        <EditorArea editor={editor} />
        {quote && (
          <div className="px-4 pb-2">
            <Tooltip content="Show quoted text">
              <button
                type="button"
                aria-label="Show quoted text"
                onClick={showQuote}
                className="focus-ring flex h-4 items-center rounded-full bg-surface-2 px-2 text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                <MoreHorizontal size={14} />
              </button>
            </Tooltip>
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-accent">
            Drop files to attach
          </div>
        )}
      </div>

      {me.signature && (
        <div className="border-t px-4 py-2">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <Checkbox checked={includeSignature} onChange={setIncludeSignature} label="Add signature" />
            Add signature
          </label>
          {signature && (
            <div className="scroll-thin mt-2 max-h-28 overflow-y-auto rounded-md border bg-white px-2">
              <HtmlFrame html={withSignature("", signature)} allowRemote />
            </div>
          )}
        </div>
      )}

      {(files.length > 0 || forwardAtt.length > 0) && (
        <div className="flex flex-wrap gap-1.5 border-t bg-surface-2/50 px-4 py-2">
          {forwardAtt.map((a) => (
            <FileChip key={a.partId} name={a.filename} size={a.size} onRemove={() => setForwardAtt((l) => l.filter((x) => x.partId !== a.partId))} />
          ))}
          {files.map((f, i) => (
            <FileChip key={`${f.name}-${f.size}-${i}`} name={f.name} size={f.size} file={f} onRemove={() => setFiles((l) => l.filter((_, j) => j !== i))} />
          ))}
          {totalSize > 0 && <span className="self-center pl-1 text-[11px] text-fg-faint">{formatBytes(totalSize)} total</span>}
        </div>
      )}

      <div className="border-t px-3 py-1.5">
        <EditorToolbar editor={editor} onInsertImage={() => imageInput.current?.click()} />
      </div>
      <div className="flex items-center gap-1 border-t px-3 py-2">
        <Tooltip content="Send (Ctrl+Enter)">
          <Button variant="primary" onClick={() => void send()} loading={sending} className="px-4">
            <Send size={14} /> Send
          </Button>
        </Tooltip>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ""))} />
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (editor && e.target.files) void insertImages(editor, Array.from(e.target.files), addFiles);
            e.target.value = "";
          }}
        />
        <IconButton label="Attach files" onClick={() => fileInput.current?.click()} className="ml-1">
          <Paperclip size={16} />
        </IconButton>
        <div className="flex-1" />
        <DraftStatus saving={saving} savedAt={savedAt} failed={saveFailed} />
        <IconButton label="Discard" tone="danger" className="ml-1" onClick={() => (hasContent ? setConfirmDiscard(true) : discard())}>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </>
  );

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (e.dataTransfer.files.length) {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }
      setDragging(false);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
        e.preventDefault();
        void send();
      }
    },
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this message?"
        description="What you've written will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={discard}
      />
      <ConfirmDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)} title={ask?.title ?? ""} description={ask?.description} confirmLabel={ask?.confirmLabel} onConfirm={() => ask?.onConfirm()} />
    </>
  );

  if (inline) {
    return (
      <>
        <section role="dialog" aria-label="Compose message" className="animate-slide-up flex flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-pop" {...dropHandlers}>
          <div className="flex items-center gap-2 border-b bg-surface-2/60 py-1 pr-1.5 pl-4 text-xs text-fg-muted">
            {state.mode === "forward" ? <CornerUpRight size={13} /> : <CornerUpLeft size={13} />}
            <span className="min-w-0 flex-1 truncate font-medium">{modeLabel}</span>
            <IconButton label="Open in a window" size="sm" onClick={() => updateComposer({ placement: "dock", thread: null }, state.key)}>
              <PictureInPicture2 size={13} />
            </IconButton>
            <IconButton label="Save and close" size="sm" onClick={() => void close()}>
              <X size={14} />
            </IconButton>
          </div>
          {fields}
          {body}
        </section>
        {dialogs}
      </>
    );
  }

  return (
    <>
      {state.expanded && <div className="animate-overlay-in fixed inset-0 z-40 bg-black/40" onClick={() => updateComposer({ expanded: false }, state.key)} />}
      <div
        role="dialog"
        aria-label="Compose message"
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border bg-surface shadow-float",
          state.expanded
            ? "animate-dialog-in top-1/2 left-1/2 h-[85vh] w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl"
            : "animate-slide-up right-6 bottom-0 h-[min(640px,calc(100vh-4rem))] w-[min(680px,calc(100vw-2rem))] rounded-t-xl border-b-0 max-md:inset-0 max-md:h-full max-md:w-full max-md:rounded-none",
        )}
        {...dropHandlers}
      >
        <div className="flex items-center gap-0.5 border-b bg-surface-2 py-1.5 pr-1.5 pl-4">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          <IconButton label="Minimize" size="sm" onClick={() => updateComposer({ minimized: true }, state.key)}>
            <Minus size={14} />
          </IconButton>
          <IconButton label={state.expanded ? "Smaller" : "Larger"} size="sm" className="max-md:hidden" onClick={() => updateComposer({ expanded: !state.expanded }, state.key)}>
            {state.expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </IconButton>
          <IconButton label="Save and close" size="sm" onClick={() => void close()}>
            <X size={14} />
          </IconButton>
        </div>
        {fields}
        {body}
      </div>
      {dialogs}
    </>
  );
}
