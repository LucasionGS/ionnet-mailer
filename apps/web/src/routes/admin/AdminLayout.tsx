import type { ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Globe, LayoutDashboard, Mails, ScrollText, Server, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/admin/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/domains", label: "Domains", icon: Globe },
  { to: "/admin/mail", label: "Mail flow", icon: Mails },
  { to: "/admin/security", label: "Security", icon: ShieldCheck },
  { to: "/admin/logs", label: "Server logs", icon: ScrollText },
  { to: "/admin/status", label: "System", icon: Server },
] as const;

export function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex h-full min-h-0 max-md:flex-col">
      <nav aria-label="Administration" className="flex w-52 shrink-0 flex-col gap-0.5 border-r p-3 max-md:hidden">
        <div className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">Administration</div>
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                active ? "bg-accent-soft font-medium text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Administration" className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 md:hidden">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", active ? "bg-accent-soft text-accent" : "text-fg-muted")}
            >
              <Icon size={13} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

/** Page header inside the admin area: title, optional back link, actions on the right. */
export function AdminHeader({ title, description, back, children }: { title: ReactNode; description?: ReactNode; back?: { to: string; label: string }; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-5 py-3">
      {back && (
        <Link to={back.to} className="focus-ring -ml-1 flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg" aria-label={`Back to ${back.label}`}>
          <ArrowLeft size={15} />
          <span className="max-sm:hidden">{back.label}</span>
        </Link>
      )}
      {back && <span className="text-fg-faint max-sm:hidden">/</span>}
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {description && <p className="truncate text-xs text-fg-muted">{description}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
