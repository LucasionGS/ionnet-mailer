import { useSyncExternalStore } from "react";
import type { Message, MessageRef } from "@ionnet/shared";

export interface Recipient {
  name: string;
  address: string;
}

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposerState {
  key: number;
  mode: ComposeMode;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  html: string;
  /** quoted original that is not in the editor yet; it is tucked behind "…" and appended on send */
  quote: string;
  inReplyTo: MessageRef | null;
  replyMode: "reply" | "forward" | null;
  /** In-Reply-To/References of a reply reopened from Drafts, which has no `inReplyTo` message any more */
  threadHeaders: { inReplyTo: string; references: string[] } | null;
  forwardAttachments: Array<{ ref: MessageRef; partId: string; filename: string; size: number }>;
  draftUid: number | null;
  /** add the user's signature on send (only applies when they have one) */
  signature: boolean;
  minimized: boolean;
  expanded: boolean;
  /** original message when replying/forwarding (for quoting) */
  original: Message | null;
  /** address to send from; null means the account's own address */
  fromAddress: string | null;
  /** files picked in this session (never restored from a saved draft) */
  files: File[];
  /**
   * "inline" composers live at the bottom of the conversation they answer, as long as that conversation is on
   * screen; anywhere else they fall back to the docked window.
   */
  placement: "dock" | "inline";
  /** conversation hosting an inline composer */
  thread: { folder: string; id: string } | null;
}

let state: ComposerState | null = null;
let key = 1;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export type ComposerInit = Partial<Omit<ComposerState, "key" | "minimized" | "expanded">>;

export function openComposer(init: ComposerInit = {}) {
  state = {
    key: key++,
    mode: init.mode ?? "new",
    to: init.to ?? [],
    cc: init.cc ?? [],
    bcc: init.bcc ?? [],
    subject: init.subject ?? "",
    html: init.html ?? "",
    quote: init.quote ?? "",
    inReplyTo: init.inReplyTo ?? null,
    replyMode: init.replyMode ?? null,
    threadHeaders: init.threadHeaders ?? null,
    forwardAttachments: init.forwardAttachments ?? [],
    draftUid: init.draftUid ?? null,
    signature: init.signature ?? true,
    original: init.original ?? null,
    fromAddress: init.fromAddress ?? null,
    files: init.files ?? [],
    placement: init.placement ?? "dock",
    thread: init.thread ?? null,
    minimized: false,
    expanded: false,
  };
  emit();
}

export function closeComposer(forKey?: number) {
  if (forKey !== undefined && state?.key !== forKey) return;
  state = null;
  emit();
}

export function getComposer(): ComposerState | null {
  return state;
}

/** Pass `forKey` when the caller may outlive its composer, so a late update can't leak into the next one. */
export function updateComposer(patch: Partial<ComposerState>, forKey?: number) {
  if (!state || (forKey !== undefined && state.key !== forKey)) return;
  state = { ...state, ...patch };
  emit();
}

/**
 * Records what the user typed without re-rendering anyone. When an inline reply moves to the docked window, the new
 * composer reads the store while rendering, before the old one's unmount cleanup runs, so the store must already
 * hold the latest text. The state object is updated in place, which is why no listener is told.
 */
export function stashComposer(patch: Partial<ComposerState>, forKey: number) {
  if (!state || state.key !== forKey) return;
  Object.assign(state, patch);
}

let flush: (() => Promise<boolean>) | null = null;

/** The mounted composer hands over a way to save itself as a draft and close; returns the unregister function. */
export function registerComposerFlush(fn: () => Promise<boolean>) {
  flush = fn;
  return () => {
    if (flush === fn) flush = null;
  };
}

/** Saves the open composer to Drafts and closes it, before leaving the account. False when the draft didn't save. */
export async function flushComposer(): Promise<boolean> {
  if (!state) return true;
  return flush ? flush() : true;
}

export function isComposerOpen() {
  return state !== null;
}

export function useComposer(): ComposerState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
