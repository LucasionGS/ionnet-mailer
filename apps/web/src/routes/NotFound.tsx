import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/ui";

export function NotFoundPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Link to="/mail/$folder" params={{ folder: "INBOX" }} className="text-xs font-medium text-accent hover:underline">
            Go to inbox
          </Link>
        }
      />
    </div>
  );
}
