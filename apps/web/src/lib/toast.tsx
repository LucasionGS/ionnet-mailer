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
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto animate-fade-in flex items-start gap-3 rounded-lg border bg-surface p-3 shadow-lg",
            t.kind === "error" && "border-danger/40",
            t.kind === "success" && "border-success/40",
          )}
        >
          <span
            className={cn(
              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
              t.kind === "error" ? "bg-danger" : t.kind === "success" ? "bg-success" : "bg-accent",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t.title}</div>
            {t.description && <div className="mt-0.5 text-xs text-fg-muted break-words">{t.description}</div>}
            {t.action && (
              <button
                type="button"
                className="mt-1.5 text-xs font-medium text-accent hover:underline"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
