import { useSyncExternalStore } from "react";

export interface Prefs {
  /** seconds a sent message is held back so it can be undone; 0 sends immediately */
  undoSendSeconds: 0 | 5 | 10 | 20;
  /** width of the conversation list on wide screens */
  listWidth: number;
  foldersCollapsed: boolean;
}

const KEY = "ionnet.prefs";
const DEFAULTS: Prefs = { undoSendSeconds: 5, listWidth: 400, foldersCollapsed: false };
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // ignore
  }
  return DEFAULTS;
}

let prefs = read();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => prefs,
  );
}
