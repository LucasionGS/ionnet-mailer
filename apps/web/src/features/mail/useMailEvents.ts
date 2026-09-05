import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeMailEvents } from "@/lib/api";
import { invalidateMail, qk } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { displayAddress } from "@/lib/utils";

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
            onNewRef.current?.(e.folder, e.uid);
            break;
          }
          case "expunge":
          case "flags":
            invalidateMail(qc, e.folder);
            void qc.invalidateQueries({ queryKey: qk.message(e.folder, e.uid) });
            break;
          case "folders":
            void qc.invalidateQueries({ queryKey: qk.folders });
            break;
          case "ping":
            break;
        }
      },
      (connected) => {
        // Mail that arrived while the stream was down produced no event, so the
        // first thing a reconnect must do is resync everything under "mail".
        if (!connected) return;
        if (connectedBefore) void qc.invalidateQueries({ queryKey: ["mail"] });
        connectedBefore = true;
      },
    );
  }, [qc]);
}
