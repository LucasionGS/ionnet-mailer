import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  tone?: "default" | "danger";
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, tone = "default", className, children, type = "button", tooltipSide, ...rest },
  ref,
) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "focus-ring inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          size === "sm" ? "h-7 w-7" : "h-8 w-8",
          active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          tone === "danger" && "hover:bg-danger-soft hover:text-danger",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
