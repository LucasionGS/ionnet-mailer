import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeMailEvents } from "@/lib/api";
import { invalidateMail, qk } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { displayAddress } from "@/lib/utils";

/** Keeps the mail cache fresh from the server-sent event stream while mounted. */
export function useMailEvents(onNew?: (folder: string, uid: number) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    const unsub = subscribeMailEvents((e) => {
      switch (e.type) {
        case "new": {
          invalidateMail(qc, e.folder);
          const who = displayAddress(e.from) || "Unknown sender";
          toast.info(who, e.subject || "(no subject)");
          onNew?.(e.folder, e.uid);
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
    });
    return unsub;
  }, [qc, onNew]);
}
