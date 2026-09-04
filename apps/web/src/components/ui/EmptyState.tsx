import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-48 flex-col items-center justify-center gap-2 p-8 text-center", className)}>
      {icon && <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-fg-faint">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="max-w-sm text-xs text-fg-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <EmptyState
      title="Something went wrong"
      description={msg}
      action={
        retry && (
          <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={retry}>
            Try again
          </button>
        )
      }
    />
  );
}
