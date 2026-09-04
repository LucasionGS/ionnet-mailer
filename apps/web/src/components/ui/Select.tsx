import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, className, ...rest }, ref) {
  return (
    <div className={cn("relative", className)}>
      <select
        ref={ref}
        className="focus-ring h-8.5 w-full appearance-none rounded-md border border-border-strong bg-surface pr-8 pl-2.5 text-sm text-fg transition-colors focus:border-accent disabled:opacity-60"
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-faint" />
    </div>
  );
});
