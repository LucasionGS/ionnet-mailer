import { useSyncExternalStore } from "react";

/** Whether the folder drawer is open on small screens. The button lives in the top bar, the drawer in the mail page. */
let drawerOpen = false;
const listeners = new Set<() => void>();

export function setDrawerOpen(open: boolean) {
  drawerOpen = open;
  listeners.forEach((l) => l());
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => drawerOpen,
  );
}

export const SEARCH_INPUT_ID = "mail-search";
