import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { BookUser, LogOut, Mail, Monitor, Moon, Settings, ShieldCheck, Sun, PenSquare } from "lucide-react";
import { useMe, useLogout, useFolders } from "@/lib/queries";
import { useTheme, type ThemeSetting } from "@/lib/theme";
import { cn, initials, avatarColor } from "@/lib/utils";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./ui/Menu";
import { Tooltip } from "./ui/Tooltip";
import { Composer } from "@/features/mail/Composer";
import { openComposer, useComposer } from "@/features/mail/composerStore";
import { newMessageInit } from "@/features/mail/compose";
import { useMailEvents } from "@/features/mail/useMailEvents";
import { APP_NAME } from "@ionnet/shared";

function RailLink({
  to,
  icon,
  label,
  active,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Tooltip content={label} side="right">
      <Link
        to={to}
        className={cn(
          "focus-ring relative flex h-11 w-11 flex-col items-center justify-center rounded-xl transition-colors",
          active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        )}
        aria-label={label}
      >
        {icon}
        {badge ? (
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-accent-fg">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </Link>
    </Tooltip>
  );
}

export function AppShell() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, setTheme] = useTheme();
  const composer = useComposer();
  const { data: folders } = useFolders();
  const inboxUnread = folders?.find((f) => f.specialUse === "inbox")?.unread ?? 0;

  useMailEvents();

  const themeOptions: Array<{ v: ThemeSetting; label: string; icon: React.ReactNode }> = [
    { v: "system", label: "System", icon: <Monitor size={14} /> },
    { v: "light", label: "Light", icon: <Sun size={14} /> },
    { v: "dark", label: "Dark", icon: <Moon size={14} /> },
  ];

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r bg-surface py-3">
        <Link to="/mail/$folder" params={{ folder: "INBOX" }} className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg" aria-label={APP_NAME}>
          <Mail size={18} />
        </Link>
        <Tooltip content="Compose (c)" side="right">
          <button
            type="button"
            onClick={() => openComposer(newMessageInit(me))}
            className="focus-ring mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-border-strong bg-surface text-fg shadow-sm transition-colors hover:bg-surface-2"
            aria-label="Compose"
          >
            <PenSquare size={17} />
          </button>
        </Tooltip>
        <RailLink to="/mail/INBOX" icon={<Mail size={19} />} label="Mail" active={pathname.startsWith("/mail")} badge={inboxUnread} />
        <RailLink to="/contacts" icon={<BookUser size={19} />} label="Contacts" active={pathname.startsWith("/contacts")} />
        <RailLink to="/settings" icon={<Settings size={19} />} label="Settings" active={pathname.startsWith("/settings")} />
        {me?.isAdmin && (
          <RailLink to="/admin/domains" icon={<ShieldCheck size={19} />} label="Admin" active={pathname.startsWith("/admin")} />
        )}
        <div className="flex-1" />
        {me && (
          <Menu
            side="right"
            align="end"
            trigger={
              <button
                type="button"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ background: avatarColor(me.email) }}
                aria-label="Account menu"
              >
                {initials(me.displayName || me.email)}
              </button>
            }
          >
            <MenuLabel>
              <div className="truncate text-fg">{me.displayName}</div>
              <div className="truncate font-normal">{me.email}</div>
            </MenuLabel>
            <MenuSeparator />
            <MenuLabel>Theme</MenuLabel>
            {themeOptions.map((o) => (
              <MenuItem key={o.v} icon={o.icon} checked={theme === o.v} onSelect={() => setTheme(o.v)}>
                {o.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Settings size={14} />} onSelect={() => navigate({ to: "/settings" })}>
              Settings
            </MenuItem>
            <MenuItem
              icon={<LogOut size={14} />}
              onSelect={() => {
                logout.mutate(undefined, {
                  onSettled: () => {
                    window.location.href = "/login";
                  },
                });
              }}
            >
              Sign out
            </MenuItem>
          </Menu>
        )}
      </nav>
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      {composer && me && <Composer key={composer.key} state={composer} me={me} />}
    </div>
  );
}
