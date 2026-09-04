import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RT.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "bottom",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="z-[70] max-w-xs rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-md select-none"
        >
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
