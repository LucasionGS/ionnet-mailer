import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { cn } from "./utils";

export type ToastKind = "info" | "success" | "error";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  /** show a bar that runs out over this many ms (the caller decides what happens when it does) */
  countdownMs?: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function toast(input: Omit<ToastItem, "id"> & { duration?: number }) {
  const id = nextId++;
  const { duration = input.kind === "error" ? 7000 : 4000, ...rest } = input;
  items = [...items, { id, ...rest }];
  emit();
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}
toast.success = (title: string, description?: string) => toast({ kind: "success", title, description });
toast.error = (title: string, description?: string) => toast({ kind: "error", title, description });
toast.info = (title: string, description?: string, action?: ToastItem["action"]) => toast({ kind: "info", title, description, action });

/** Change a toast that is already showing, e.g. "Sending…" into "Sent". Restarts its timer. */
export function updateToast(id: number, patch: Partial<Omit<ToastItem, "id">> & { duration?: number }) {
  const { duration, ...rest } = patch;
  if (!items.some((t) => t.id === id)) return;
  items = items.map((t) => (t.id === id ? { ...t, countdownMs: undefined, action: undefined, ...rest } : t));
  emit();
  if (duration && duration > 0) setTimeout(() => dismiss(id), duration);
}

export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
}

export function Toaster() {
  const list = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[100] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 max-md:bottom-16">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto animate-toast-in relative flex items-center gap-3 overflow-hidden rounded-lg bg-fg py-2.5 pr-2 pl-3.5 text-bg shadow-float"
        >
          {t.kind !== "info" && <span className={cn("h-2 w-2 shrink-0 rounded-full", t.kind === "error" ? "bg-danger" : "bg-success")} />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.title}</div>
            {t.description && <div className="mt-0.5 line-clamp-3 text-xs break-words opacity-70">{t.description}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-bg underline-offset-2 hover:bg-bg/10 hover:underline"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" className="shrink-0 rounded-md p-1 opacity-60 hover:bg-bg/10 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
          {t.countdownMs && (
            <span
              className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-bg/50"
              style={{ animation: `countdown ${t.countdownMs}ms linear forwards` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
