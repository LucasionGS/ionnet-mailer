import * as RP from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  side = "top",
  align = "start",
  className,
}: {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn("z-[60] animate-pop-in rounded-lg border bg-surface p-2 shadow-pop outline-none", className)}
        >
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
