import { useSyncExternalStore } from "react";

/**
 * Accounts this browser has been signed in to. The server only knows the live sessions; this list also keeps the
 * ones whose session ran out or was revoked, so the switcher can offer them again with the email filled in. Signing
 * out on purpose forgets an account.
 */
export interface RememberedAccount {
  id: string;
  email: string;
  displayName: string;
}

const KEY = "ionnet.accounts";
const listeners = new Set<() => void>();

function read(): RememberedAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as RememberedAccount[]).filter((a) => a && typeof a.id === "string" && typeof a.email === "string") : [];
  } catch {
    return [];
  }
}

let remembered = read();

function write(next: RememberedAccount[]) {
  remembered = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

/** Adds or refreshes accounts, keeping the order they were first seen in. */
export function rememberAccounts(list: RememberedAccount[]) {
  const next = remembered.map((a) => {
    const hit = list.find((b) => b.id === a.id);
    return hit ? { id: hit.id, email: hit.email, displayName: hit.displayName } : a;
  });
  for (const a of list) if (!next.some((b) => b.id === a.id)) next.push({ id: a.id, email: a.email, displayName: a.displayName });
  if (JSON.stringify(next) !== JSON.stringify(remembered)) write(next);
}

export function forgetAccounts(ids: string[]) {
  if (remembered.some((a) => ids.includes(a.id))) write(remembered.filter((a) => !ids.includes(a.id)));
}

export function useRememberedAccounts(): RememberedAccount[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => remembered,
  );
}
