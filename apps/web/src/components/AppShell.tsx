import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { BookUser, Mail, Menu as MenuIcon, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useMe, useFolders } from "@/lib/queries";
import { getPrefs, setPrefs } from "@/lib/prefs";
import { SEARCH_INPUT_ID, setDrawerOpen } from "@/lib/ui";
import { cn, decodeFolder, encodeFolder } from "@/lib/utils";
import { IconButton } from "./ui/IconButton";
import { Tooltip } from "./ui/Tooltip";
import { Composer } from "@/features/mail/Composer";
import { useComposer } from "@/features/mail/composerStore";
import { useMailEvents } from "@/features/mail/useMailEvents";
import { usePendingSetupSteps } from "@/features/admin/SetupSteps";
import { AccountMenu } from "@/features/account/AccountMenu";
import { APP_NAME } from "@ionnet/shared";

interface NavItem {
  to: string;
  match: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  /** show the badge dot in the warning colour: something needs an admin, not unread mail */
  alert?: boolean;
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Tooltip content={item.label} side="right">
      <Link
        to={item.to}
        className={cn(
          "focus-ring relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-3/70 hover:text-fg",
        )}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
      >
        {active && <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r bg-accent" />}
        {item.icon}
        {item.badge ? <span className={cn("absolute top-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-bg", item.alert ? "bg-warning" : "bg-accent")} /> : null}
      </Link>
    </Tooltip>
  );
}

/** Search box in the top bar. It searches the folder you are looking at, or the inbox from anywhere else. */
function SearchBox() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { folder?: string };
  const search = useRouterState({ select: (s) => s.location.search }) as { q?: string };
  const folder = params.folder ? decodeFolder(params.folder) : "INBOX";
  const q = params.folder ? (search.q ?? "") : "";
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const { data: folders } = useFolders();
  const folderName = folders?.find((f) => f.path === folder)?.name ?? folder;

  const go = (value: string) => void navigate({ to: "/mail/$folder", params: { folder: encodeFolder(folder) }, search: value ? { q: value } : {} });

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(text.trim());
      }}
      className="group relative w-full max-w-2xl"
    >
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint group-focus-within:text-accent" />
      <input
        id={SEARCH_INPUT_ID}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        placeholder={`Search ${folderName}`}
        aria-label={`Search ${folderName}`}
        className="h-9 w-full rounded-lg border border-transparent bg-surface-3/70 pr-9 pl-9 text-sm outline-none transition-colors placeholder:text-fg-faint hover:bg-surface-3 focus:border-accent focus:bg-surface focus:shadow-sm"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg"
          onClick={() => {
            setText("");
            if (q) go("");
          }}
        >
          <X size={14} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[11px] text-fg-faint group-focus-within:hidden max-md:hidden">/</kbd>
      )}
    </form>
  );
}

export function AppShell() {
  const { data: me } = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const composer = useComposer();
  const { data: folders } = useFolders();
  const inboxUnread = folders?.find((f) => f.specialUse === "inbox")?.unread ?? 0;
  const onMail = pathname.startsWith("/mail");
  const pendingSteps = usePendingSetupSteps(!!me?.isAdmin);

  useMailEvents();

  useEffect(() => {
    document.title = inboxUnread ? `(${inboxUnread}) ${APP_NAME}` : APP_NAME;
  }, [inboxUnread]);

  const nav: NavItem[] = [
    { to: "/mail/INBOX", match: "/mail", label: "Mail", icon: <Mail size={19} />, badge: inboxUnread },
    { to: "/contacts", match: "/contacts", label: "Contacts", icon: <BookUser size={19} /> },
    { to: "/settings", match: "/settings", label: "Settings", icon: <Settings size={19} /> },
    ...(me?.isAdmin ? [{ to: "/admin/overview", match: "/admin", label: "Admin", icon: <ShieldCheck size={19} />, badge: pendingSteps, alert: true }] : []),
  ];

  // An inline reply stays with its conversation; anywhere else the same composer shows up as the docked window.
  const params = useParams({ strict: false }) as { folder?: string; threadId?: string };
  const hostedInline =
    composer?.placement === "inline" && !!composer.thread && !!params.folder && decodeFolder(params.folder) === composer.thread.folder && params.threadId === composer.thread.id;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 px-2 md:gap-3 md:px-3">
        <div className="flex shrink-0 items-center gap-1 md:w-[17.5rem]">
          {onMail && (
            <IconButton
              label="Folders"
              onClick={() => {
                if (window.matchMedia("(min-width: 768px)").matches) setPrefs({ foldersCollapsed: !getPrefs().foldersCollapsed });
                else setDrawerOpen(true);
              }}
            >
              <MenuIcon size={18} />
            </IconButton>
          )}
          <Link to="/mail/$folder" params={{ folder: "INBOX" }} className={cn("focus-ring flex items-center gap-2 rounded-md px-1.5 py-1", !onMail && "md:ml-9")} aria-label={APP_NAME}>
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
              <Mail size={15} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight max-sm:hidden">{APP_NAME}</span>
          </Link>
        </div>
        <div className="flex min-w-0 flex-1 justify-start">
          <SearchBox />
        </div>
        {me && <AccountMenu me={me} />}
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 pt-1 max-md:hidden" aria-label="Apps">
          {nav.map((item) => (
            <RailLink key={item.to} item={item} active={pathname.startsWith(item.match)} />
          ))}
        </nav>
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {onMail ? (
            <Outlet />
          ) : (
            <div className="h-full overflow-hidden border-t bg-surface md:rounded-tl-xl md:border-l">
              <Outlet />
            </div>
          )}
        </main>
      </div>

      <nav className="flex h-14 shrink-0 items-stretch border-t bg-surface md:hidden" aria-label="Apps">
        {nav.map((item) => {
          const active = pathname.startsWith(item.match);
          return (
            <Link key={item.to} to={item.to} className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-accent" : "text-fg-muted")}>
              <span className="relative">
                {item.icon}
                {item.badge ? <span className={cn("absolute -top-0.5 -right-1 h-2 w-2 rounded-full ring-2 ring-surface", item.alert ? "bg-warning" : "bg-accent")} /> : null}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {composer && me && !hostedInline && <Composer key={composer.key} state={composer} me={me} variant="dock" />}
    </div>
  );
}
