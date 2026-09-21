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
