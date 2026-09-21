import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Maximize2, Minimize2, Minus, Paperclip, Send, Trash2, X } from "lucide-react";
import type { DraftRequest, Me, SendRequest } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";
import { errorMessage, saveDraft, sendMail } from "@/lib/api";
import { invalidateMail } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button, Checkbox, ConfirmDialog, IconButton, Tooltip } from "@/components/ui";
import { closeComposer, updateComposer, type ComposerState, type Recipient } from "./composerStore";
import { RecipientInput } from "./RecipientInput";
import { EditorArea, EditorToolbar, useMailEditor } from "./Editor";
import { HtmlFrame } from "./HtmlFrame";
import { withSignature } from "./compose";

const MAX_TOTAL = 40 * 1024 * 1024;

function stripHtml(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").trim();
}

export function Composer({ state, me }: { state: ComposerState; me: Me }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<Recipient[]>(state.to);
  const [cc, setCc] = useState<Recipient[]>(state.cc);
  const [bcc, setBcc] = useState<Recipient[]>(state.bcc);
  const [showCc, setShowCc] = useState(state.cc.length > 0);
  const [showBcc, setShowBcc] = useState(state.bcc.length > 0);
  const [subject, setSubject] = useState(state.subject);
  const [files, setFiles] = useState<File[]>([]);
  const [forwardAtt, setForwardAtt] = useState(state.forwardAttachments);
  const [includeSignature, setIncludeSignature] = useState(state.signature);
  const signature = includeSignature ? me.signature : null;
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const draftUid = useRef<number | null>(state.draftUid);
  const dirty = useRef(false);
  const lastSaved = useRef<string>("");
  const htmlRef = useRef(state.html);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const editor = useMailEditor(state.html, (html) => {
    htmlRef.current = html;
    dirty.current = true;
    scheduleSave();
  });

  useEffect(() => {
    if (state.mode === "new" || state.mode === "forward" || (state.mode === "draft" && !to.length)) return;
    editor?.commands.focus("start");
  }, [editor, state.mode, to.length]);

  const snapshot = useCallback(
    () => JSON.stringify({ to, cc, bcc, subject, html: htmlRef.current, signature, files: files.map((f) => f.name + f.size), forwardAtt }),
    [to, cc, bcc, subject, signature, files, forwardAtt],
  );

  const payloadBase = useCallback(
    () => ({
      to,
      cc,
      bcc,
      subject,
      html: signature ? withSignature(htmlRef.current, signature) : htmlRef.current,
      fromName: me.displayName,
      fromAddress: me.email,
      inReplyTo: state.inReplyTo,
      replyMode: state.replyMode,
      forwardAttachments: forwardAtt.map((a) => ({ ref: a.ref, partId: a.partId })),
      requestReadReceipt: false,
    }),
    [to, cc, bcc, subject, signature, me, state.inReplyTo, state.replyMode, forwardAtt],
  );

  const doSaveDraft = useCallback(
    async (silent = true) => {
      const snap = snapshot();
      if (snap === lastSaved.current) return;
      if (!to.length && !cc.length && !bcc.length && !subject.trim() && !stripHtml(htmlRef.current) && !files.length) return;
      setSaving(true);
      try {
        const body: DraftRequest = { ...payloadBase(), draftUid: draftUid.current };
        const r = await saveDraft(body, files);
        draftUid.current = r.uid;
        updateComposer({ draftUid: r.uid });
        lastSaved.current = snap;
        dirty.current = false;
        invalidateMail(qc);
        if (!silent) toast.success("Draft saved");
      } catch (err) {
        if (!silent) toast.error("Could not save draft", errorMessage(err));
      } finally {
        setSaving(false);
      }
    },
    [snapshot, to, cc, bcc, subject, files, payloadBase, qc],
  );

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void doSaveDraft(true), 10_000);
  }, [doSaveDraft]);

  useEffect(() => {
    dirty.current = true;
    scheduleSave();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [to, cc, bcc, subject, signature, files, forwardAtt, scheduleSave]);

  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0) + forwardAtt.reduce((s, a) => s + a.size, 0), [files, forwardAtt]);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const next = [...files];
    let size = totalSize;
    for (const f of incoming) {
      if (size + f.size > MAX_TOTAL) {
        toast.error("Attachment too large", `Total attachments must stay under ${formatBytes(MAX_TOTAL)}.`);
        break;
      }
      size += f.size;
      next.push(f);
    }
    setFiles(next);
  };

  const close = async (save: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    if (save) await doSaveDraft(true);
    closeComposer();
  };

  const send = async () => {
    if (!to.length) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!subject.trim() && !window.confirm("Send this message without a subject?")) return;
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      const body: SendRequest = { ...payloadBase(), draftUid: draftUid.current };
      await sendMail(body, files);
      toast.success("Message sent");
      invalidateMail(qc);
      closeComposer();
    } catch (err) {
      toast.error("Could not send", errorMessage(err));
      setSending(false);
    }
  };

  const discard = () => {
    if (timer.current) clearTimeout(timer.current);
    closeComposer();
    // A draft that already exists on the server stays in Drafts; the user can delete it there.
  };

  const hasContent = to.length || cc.length || bcc.length || subject.trim() || stripHtml(htmlRef.current).length > 0 || files.length;
  const title = subject.trim() || (state.mode === "new" ? "New message" : state.mode === "forward" ? "Forward" : "Reply");

  if (state.minimized) {
    return (
      <div className="fixed right-6 bottom-0 z-40 flex w-72 items-center gap-2 rounded-t-lg border border-b-0 bg-fg px-3 py-2 text-bg shadow-xl">
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => updateComposer({ minimized: false })}>
          {title}
        </button>
        <IconButton label="Restore" size="sm" className="text-bg hover:bg-bg/10 hover:text-bg" onClick={() => updateComposer({ minimized: false })}>
          <Maximize2 size={13} />
        </IconButton>
        <IconButton label="Close" size="sm" className="text-bg hover:bg-bg/10 hover:text-bg" onClick={() => void close(true)}>
          <X size={14} />
        </IconButton>
      </div>
    );
  }

  return (
    <>
      {state.expanded && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => updateComposer({ expanded: false })} />}
      <div
        role="dialog"
        aria-label="Compose message"
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden rounded-t-xl border bg-surface shadow-2xl animate-fade-in",
          state.expanded
            ? "top-1/2 left-1/2 h-[85vh] w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl"
            : "right-6 bottom-0 h-[min(600px,calc(100vh-2rem))] w-[min(560px,calc(100vw-2rem))] max-md:right-0 max-md:w-full",
        )}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }
          setDragging(false);
        }}
      >
        <div className="flex items-center gap-1 bg-fg px-3 py-2 text-bg">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          {saving && <span className="mr-2 text-[11px] opacity-70">Saving…</span>}
          <IconButton label="Minimize" size="sm" className="text-bg hover:bg-bg/10 hover:text-bg" onClick={() => updateComposer({ minimized: true })}>
            <Minus size={14} />
          </IconButton>
          <IconButton
            label={state.expanded ? "Restore" : "Expand"}
            size="sm"
            className="text-bg hover:bg-bg/10 hover:text-bg"
            onClick={() => updateComposer({ expanded: !state.expanded })}
          >
            {state.expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </IconButton>
          <IconButton label="Save and close" size="sm" className="text-bg hover:bg-bg/10 hover:text-bg" onClick={() => void close(true)}>
            <X size={14} />
          </IconButton>
        </div>

        <RecipientInput
          label="To"
          value={to}
          onChange={setTo}
          autoFocus={!to.length}
          placeholder="Recipients"
          extra={
            <div className="flex shrink-0 gap-1 pt-1 text-xs text-fg-muted">
              {!showCc && (
                <button type="button" className="hover:text-fg" onClick={() => setShowCc(true)}>
                  Cc
                </button>
              )}
              {!showBcc && (
                <button type="button" className="hover:text-fg" onClick={() => setShowBcc(true)}>
                  Bcc
                </button>
              )}
            </div>
          }
        />
        {showCc && <RecipientInput label="Cc" value={cc} onChange={setCc} />}
        {showBcc && <RecipientInput label="Bcc" value={bcc} onChange={setBcc} />}
        <div className="flex items-center gap-2 border-b px-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-fg-faint"
          />
        </div>

        <EditorArea editor={editor} className={cn(dragging && "bg-accent-soft/40")} />

        {me.signature && (
          <div className="border-t px-3 py-2">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <Checkbox checked={includeSignature} onChange={setIncludeSignature} label="Add signature" />
              Add signature
            </label>
            {signature && (
              <div className="scroll-thin mt-2 max-h-28 overflow-y-auto rounded-md border bg-white px-2">
                <HtmlFrame html={withSignature("", signature)} allowRemote dark={false} />
              </div>
            )}
          </div>
        )}

        {(files.length > 0 || forwardAtt.length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
            {forwardAtt.map((a) => (
              <span key={a.partId} className="flex items-center gap-1.5 rounded-md border bg-surface-2 px-2 py-1 text-xs">
                <FileText size={12} className="text-fg-muted" />
                <span className="max-w-[180px] truncate">{a.filename}</span>
                <span className="text-fg-faint">{formatBytes(a.size)}</span>
                <button type="button" aria-label="Remove" className="text-fg-faint hover:text-fg" onClick={() => setForwardAtt((l) => l.filter((x) => x.partId !== a.partId))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-md border bg-surface-2 px-2 py-1 text-xs">
                <Paperclip size={12} className="text-fg-muted" />
                <span className="max-w-[180px] truncate">{f.name}</span>
                <span className="text-fg-faint">{formatBytes(f.size)}</span>
                <button type="button" aria-label="Remove" className="text-fg-faint hover:text-fg" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 border-t px-3 py-2">
          <Button variant="primary" onClick={send} loading={sending} disabled={!to.length}>
            <Send size={14} /> Send
          </Button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <IconButton label="Attach files" onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} />
          </IconButton>
          <div className="mx-1 hidden sm:block">
            <EditorToolbar editor={editor} />
          </div>
          <div className="flex-1" />
          {totalSize > 0 && <span className="mr-2 text-[11px] text-fg-faint">{formatBytes(totalSize)}</span>}
          <Tooltip content="Discard">
            <IconButton label="Discard" tone="danger" onClick={() => (hasContent ? setConfirmDiscard(true) : discard())}>
              <Trash2 size={16} />
            </IconButton>
          </Tooltip>
        </div>
        <div className="border-t px-3 py-1 sm:hidden">
          <EditorToolbar editor={editor} />
        </div>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard message?"
        description="Unsaved changes will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={discard}
      />
    </>
  );
}
