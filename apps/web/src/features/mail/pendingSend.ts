import type { QueryClient } from "@tanstack/react-query";
import type { SendRequest } from "@ionnet/shared";
import { errorMessage, sendMail } from "@/lib/api";
import { invalidateMail } from "@/lib/queries";
import { getPrefs } from "@/lib/prefs";
import { dismiss, toast, updateToast } from "@/lib/toast";
import { openComposer, type ComposerInit } from "./composerStore";

interface Pending {
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Set<Pending>();

function warnBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
}

function track(p: Pending, on: boolean) {
  if (on) pending.add(p);
  else pending.delete(p);
  if (pending.size) window.addEventListener("beforeunload", warnBeforeUnload);
  else window.removeEventListener("beforeunload", warnBeforeUnload);
}

/**
 * Send a message after the user's undo window. The composer is already closed by the time this runs, so
 * `restore` carries everything needed to reopen it, both for Undo and for a failed send.
 */
export function queueSend(qc: QueryClient, payload: SendRequest, files: File[], restore: ComposerInit) {
  const delay = getPrefs().undoSendSeconds * 1000;
  const reopen = () => openComposer(restore);

  const deliver = async (toastId: number) => {
    updateToast(toastId, { title: "Sending…" });
    const onProgress = files.length ? (f: number) => updateToast(toastId, { title: f < 1 ? `Sending… ${Math.round(f * 100)}%` : "Sending…" }) : undefined;
    try {
      await sendMail(payload, files, onProgress);
      updateToast(toastId, { kind: "success", title: "Message sent", duration: 3000 });
      invalidateMail(qc);
    } catch (err) {
      dismiss(toastId);
      toast({ kind: "error", title: "Could not send", description: errorMessage(err), action: { label: "Edit message", onClick: reopen }, duration: 15000 });
    }
  };

  const p: Pending = { timer: setTimeout(() => undefined, 0) };
  // Leaving the page is only safe once the server has the message.
  track(p, true);
  if (!delay) {
    void deliver(toast({ kind: "info", title: "Sending…", duration: 0 })).finally(() => track(p, false));
    return;
  }

  const toastId = toast({
    kind: "info",
    title: "Sending…",
    duration: 0,
    countdownMs: delay,
    action: {
      label: "Undo",
      onClick: () => {
        clearTimeout(p.timer);
        track(p, false);
        reopen();
      },
    },
  });
  p.timer = setTimeout(() => void deliver(toastId).finally(() => track(p, false)), delay);
}
