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
    inReplyTo: init.inReplyTo ?? null,
    replyMode: init.replyMode ?? null,
    forwardAttachments: init.forwardAttachments ?? [],
    draftUid: init.draftUid ?? null,
    signature: init.signature ?? true,
    original: init.original ?? null,
    minimized: false,
    expanded: false,
  };
  emit();
}

export function closeComposer() {
  state = null;
  emit();
}

export function updateComposer(patch: Partial<ComposerState>) {
  if (!state) return;
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
