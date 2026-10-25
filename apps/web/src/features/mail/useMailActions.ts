import { useCallback } from "react";
import type { Folder, MessageRef, MoveResult, SpecialUse } from "@ionnet/shared";
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

  /** Puts moved messages back where they came from. */
  const undo = useCallback(
    (moved: MoveResult["moved"]) => {
      const back = new Map<string, MessageRef[]>();
      for (const m of moved) back.set(m.from.folder, [...(back.get(m.from.folder) ?? []), m.to]);
      for (const [destination, messages] of back) move.mutate({ messages, destination }, { onError: onError("Could not undo") });
    },
    [move],
  );
  const doneToast = useCallback(
    (title: string, res: MoveResult) =>
      toast({ kind: "success", title, duration: 6000, action: res.moved.length ? { label: "Undo", onClick: () => undo(res.moved) } : undefined }),
    [undo],
  );

  const moveTo = useCallback(
    (messages: MessageRef[], destination: string, label?: string) => {
      if (!messages.length) return;
      move.mutate(
        { messages, destination },
        {
          onSuccess: (res) => doneToast(`Moved to ${label ?? destination}`, res),
          onError: onError("Could not move"),
        },
      );
    },
    [move, doneToast],
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
          onSuccess: (res) => (permanent ? toast.success("Deleted permanently") : doneToast("Moved to Trash", res)),
          onError: onError("Could not delete"),
        },
      );
    },
    [del, doneToast],
  );

  const junk = useCallback(
    (messages: MessageRef[]) => {
      const j = findSpecial(folders, "junk");
      if (!j) {
        toast.error("No Junk folder", "Create a folder named Junk to use this action.");
        return false;
      }
      moveTo(messages, j.path, "Junk");
      return true;
    },
    [folders, moveTo],
  );

  return { folders, markRead, setFlagged, moveTo, archive, trash, junk, busy: flag.isPending || move.isPending || del.isPending };
}
