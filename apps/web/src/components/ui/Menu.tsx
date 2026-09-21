import * as DM from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Menu({
  trigger,
  children,
  align = "end",
  side,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          side={side}
          sideOffset={6}
          className="z-[60] min-w-[180px] max-w-[320px] animate-pop-in rounded-lg border bg-surface p-1 shadow-pop outline-none"
        >
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
  shortcut,
  checked,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  checked?: boolean;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={() => onSelect?.()}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2",
        danger && "text-danger data-[highlighted]:bg-danger-soft",
      )}
    >
      {icon && <span className="flex w-4 items-center justify-center text-fg-muted">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Check size={14} className="text-accent" />}
      {shortcut && <span className="ml-4 text-xs text-fg-faint">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 py-1 text-xs font-medium text-fg-faint">{children}</DM.Label>;
}
