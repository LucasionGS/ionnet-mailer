import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeMailEvents } from "@/lib/api";
import { invalidateMail, qk } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { displayAddress } from "@/lib/utils";
import { getPrefs } from "@/lib/prefs";

/** A desktop notification for new mail, when the user turned them on and isn't looking at this tab. */
function notifyDesktop(title: string, body: string, uid: number) {
  if (!getPrefs().desktopNotifications || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, tag: `ionnet-mail-${uid}` });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** Keeps the mail cache fresh from the server-sent event stream while mounted. */
export function useMailEvents(onNew?: (folder: string, uid: number) => void) {
  const qc = useQueryClient();
  // Kept in a ref so an inline callback does not resubscribe on every render,
  // which would drop the stream and the server's dedicated IMAP connection.
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  useEffect(() => {
    let connectedBefore = false;
    return subscribeMailEvents(
      (e) => {
        switch (e.type) {
          case "new": {
            invalidateMail(qc, e.folder);
            void qc.invalidateQueries({ queryKey: qk.quota });
            const who = displayAddress(e.from) || "Unknown sender";
            toast.info(who, e.subject || "(no subject)");
            notifyDesktop(who, e.subject || "(no subject)", e.uid);
            onNewRef.current?.(e.folder, e.uid);
            break;
          }
          case "expunge":
          case "flags":
            invalidateMail(qc, e.folder);
            void qc.invalidateQueries({ queryKey: qk.message(e.folder, e.uid) });
            break;
          case "folder":
            invalidateMail(qc, e.folder);
            void qc.invalidateQueries({ queryKey: ["mail", "message", e.folder] });
            break;
          case "folders":
            void qc.invalidateQueries({ queryKey: qk.folders });
            break;
          case "ready":
          case "ping":
            break;
        }
      },
      (connected) => {
        // Mail that arrived before the stream was watching (on first load, or while it was down) produced no event,
        // so every connect resyncs: the lists and counts the first time, everything under "mail" after a drop.
        if (!connected) return;
        if (connectedBefore) void qc.invalidateQueries({ queryKey: ["mail"] });
        else invalidateMail(qc);
        connectedBefore = true;
      },
    );
  }, [qc]);
}
