import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "focus-ring h-8.5 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm text-fg placeholder:text-fg-faint transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cn(inputClass, invalid && "border-danger", className)} {...rest} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(inputClass, "h-auto min-h-20 py-2 leading-relaxed", invalid && "border-danger", className)}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-fg-muted">
          {label}
        </label>
      )}
      {children}
      {error ? <div className="text-xs text-danger">{error}</div> : hint ? <div className="text-xs text-fg-faint">{hint}</div> : null}
    </div>
  );
}
