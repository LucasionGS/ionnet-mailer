import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-overlay-in" />
        <RD.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface shadow-float outline-none data-[state=open]:animate-dialog-in",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <RD.Title className="text-base font-semibold">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-sm text-fg-muted">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">Dialog</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <button type="button" aria-label="Close" className="focus-ring rounded-md p-1 text-fg-faint hover:bg-surface-2 hover:text-fg">
                <X size={16} />
              </button>
            </RD.Close>
          </div>
          {children && <div className="scroll-thin max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex items-center justify-end gap-2 border-t px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  loading,
  onConfirm,
  requireText,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  requireText?: string;
}) {
  return (
    <ConfirmInner
      key={String(open)}
      {...{ open, onOpenChange, title, description, confirmLabel, danger, loading, onConfirm, requireText }}
    />
  );
}

import { useState } from "react";
import { Input } from "./Input";

function ConfirmInner(props: Parameters<typeof ConfirmDialog>[0]) {
  const [typed, setTyped] = useState("");
  const ok = !props.requireText || typed === props.requireText;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      description={props.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={props.danger ? "danger" : "primary"} disabled={!ok} loading={props.loading} onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      {props.requireText && (
        <div className="flex flex-col gap-2">
          <div className="text-sm text-fg-muted">
            Type <span className="rounded bg-surface-2 px-1 font-mono text-fg">{props.requireText}</span> to confirm.
          </div>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
    </Dialog>
  );
}
