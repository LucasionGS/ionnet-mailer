import type { LogoutRequest, LogoutResult, Me } from "@ionnet/shared";
import { api, errorMessage, setAccountChangedHandler } from "@/lib/api";
import { forgetAccounts } from "@/lib/accounts";
import { toast } from "@/lib/toast";
import { flushComposer, isComposerOpen } from "@/features/mail/composerStore";
import { hasPendingSends } from "@/features/mail/pendingSend";

/**
 * The active account is per browser (it lives in a cookie), so every tab has to follow a switch. Tabs tell each
 * other which account is active now; a tab showing another one starts over.
 */
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ionnet.account");

function announce(active: string | null) {
  channel?.postMessage({ active });
}

let warned = false;

/** This tab's account is no longer the active one. Reload, unless that would throw away a message being written. */
function accountChanged() {
  if (!isComposerOpen() && !hasPendingSends()) {
    window.location.reload();
    return;
  }
  if (warned) return;
  warned = true;
  toast({
    kind: "info",
    title: "You switched accounts in another tab",
    description: "Copy anything you still need from this message, then reload.",
    action: { label: "Reload", onClick: () => window.location.reload() },
    duration: 0,
  });
}
setAccountChangedHandler(accountChanged);

/** Follows switches made in other tabs; `onOther` runs when they only changed the list (e.g. signed out another account). */
export function watchAccountChanges(currentId: string, onOther: () => void): () => void {
  if (!channel) return () => undefined;
  const handle = (e: MessageEvent<{ active: string | null }>) => {
    if (e.data?.active === currentId) onOther();
    else accountChanged();
  };
  channel.addEventListener("message", handle);
  return () => channel.removeEventListener("message", handle);
}

/**
 * Leaving the account reloads the app, so anything in flight for it has to land first: the open composer is saved to
 * Drafts, and a message in its undo window has to finish sending.
 */
export async function prepareToLeave(): Promise<boolean> {
  if (hasPendingSends()) {
    toast.error("A message is still sending", "Wait until it has been sent, then try again.");
    return false;
  }
  if (!(await flushComposer())) {
    toast.error("Could not save your draft", "Save or discard the message you're writing, then try again.");
    return false;
  }
  return true;
}

export async function switchAccount(mailboxId: string) {
  if (!(await prepareToLeave())) return;
  try {
    await api.post<Me>("/api/auth/switch", { mailboxId });
  } catch (err) {
    toast.error("Could not switch account", errorMessage(err));
    return;
  }
  announce(mailboxId);
  window.location.assign("/mail/INBOX");
}

/** After signing in, from the sign-in page. */
export function signedIn(me: Me) {
  announce(me.id);
}

/**
 * Signs out the active account, another signed-in account (`mailboxId`) or all of them, and forgets them on this
 * browser. Returns true when this tab can carry on as it is.
 */
export async function signOut(currentId: string, which: LogoutRequest, forget: string[]): Promise<boolean> {
  const leaving = !!which.all || !which.mailboxId || which.mailboxId === currentId;
  if (leaving && !(await prepareToLeave())) return true;
  let res: LogoutResult;
  try {
    res = await api.post<LogoutResult>("/api/auth/logout", which);
  } catch (err) {
    toast.error("Could not sign out", errorMessage(err));
    return true;
  }
  forgetAccounts(forget);
  announce(res.active?.id ?? null);
  if (res.active?.id === currentId) return true;
  window.location.assign(res.active ? "/mail/INBOX" : "/login");
  return false;
}
