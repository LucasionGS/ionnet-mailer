import { useCallback } from "react";
import type { Folder, MessageRef, SpecialUse } from "@ionnet/shared";
import { useDeleteMessages, useFlagMessages, useFolders, useMoveMessages } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/api";

export function findSpecial(folders: Folder[] | undefined, use: SpecialUse): Folder | undefined {
  return folders?.find((f) => f.specialUse === use) ?? (use === "inbox" ? folders?.find((f) => f.path.toUpperCase() === "INBOX") : undefined);
}

export function useMailActions() {
  const { data: folders } = useFolders();
  const flag = useFlagMessages();
  const move = useMoveMessages();
  const del = useDeleteMessages();

  const onError = (title: string) => (e: unknown) => toast.error(title, errorMessage(e));

  const markRead = useCallback(
    (messages: MessageRef[], read: boolean) => {
      if (!messages.length) return;
      flag.mutate(read ? { messages, add: ["\\Seen"], remove: [] } : { messages, add: [], remove: ["\\Seen"] }, { onError: onError("Could not update") });
    },
    [flag],
  );

  const setFlagged = useCallback(
    (messages: MessageRef[], flagged: boolean) => {
      if (!messages.length) return;
      flag.mutate(flagged ? { messages, add: ["\\Flagged"], remove: [] } : { messages, add: [], remove: ["\\Flagged"] }, { onError: onError("Could not update") });
    },
    [flag],
  );

  const moveTo = useCallback(
    (messages: MessageRef[], destination: string, label?: string) => {
      if (!messages.length) return;
      move.mutate(
        { messages, destination },
        {
          onSuccess: () => toast.success(`Moved to ${label ?? destination}`),
          onError: onError("Could not move"),
        },
      );
    },
    [move],
  );

  const archive = useCallback(
    (messages: MessageRef[]) => {
      const archiveFolder = findSpecial(folders, "archive");
      if (!archiveFolder) {
        toast.error("No Archive folder", "Create a folder named Archive to use this action.");
        return;
      }
      moveTo(messages, archiveFolder.path, "Archive");
    },
    [folders, moveTo],
  );

  const trash = useCallback(
    (messages: MessageRef[], permanent = false) => {
      if (!messages.length) return;
      del.mutate(
        { messages, permanent },
        {
          onSuccess: () => toast.success(permanent ? "Deleted permanently" : "Moved to Trash"),
          onError: onError("Could not delete"),
        },
      );
    },
    [del],
  );

  const junk = useCallback(
    (messages: MessageRef[]) => {
      const j = findSpecial(folders, "junk");
      if (!j) return;
      moveTo(messages, j.path, "Junk");
    },
    [folders, moveTo],
  );

  return { folders, markRead, setFlagged, moveTo, archive, trash, junk, busy: flag.isPending || move.isPending || del.isPending };
}
