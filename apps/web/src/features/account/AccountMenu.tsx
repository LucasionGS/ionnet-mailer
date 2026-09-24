import { useEffect, useState, type ReactNode } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, Settings, Sun, UserPlus, Users } from "lucide-react";
import { MAX_ACCOUNTS, type Account, type Me } from "@ionnet/shared";
import { qk, useAccounts } from "@/lib/queries";
import { forgetAccounts, useRememberedAccounts } from "@/lib/accounts";
import { useTheme, type ThemeSetting } from "@/lib/theme";
import { cn, initials, avatarColor } from "@/lib/utils";
import { Badge, Button, Dialog, Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui";
import { prepareToLeave, signOut, switchAccount, watchAccountChanges } from "./switching";

/** A signed-in account, or one this browser remembers whose session has ended. */
interface Row {
  id: string;
  email: string;
  displayName: string;
  state: "active" | "signed-in" | "signed-out";
  unread: number | null;
}

function useAccountRows(me: Me): Row[] {
  const { data: accounts } = useAccounts();
  const remembered = useRememberedAccounts();
  const live = accounts ?? [{ id: me.id, email: me.email, displayName: me.displayName, active: true, unread: null } satisfies Account];
  const rows: Row[] = live.map((a) => ({ ...a, state: a.id === me.id ? "active" : "signed-in" }));
  for (const r of remembered) {
    if (!rows.some((a) => a.id === r.id)) rows.push({ ...r, state: "signed-out", unread: null });
  }
  // The active account leads, like the header of the menu; the rest keep their order.
  return [...rows.filter((r) => r.state === "active"), ...rows.filter((r) => r.state !== "active")];
}

function Avatar({ name, email, size = 32, dim }: { name: string; email: string; size?: number; dim?: boolean }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", dim && "opacity-45 grayscale")}
      style={{ background: avatarColor(email), width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials(name || email)}
    </span>
  );
}

function UnreadCount({ n }: { n: number | null }) {
  if (!n) return null;
  return <span className="rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-fg tabular-nums">{n > 999 ? "999+" : n}</span>;
}

/** A menu row with an avatar and two lines of text, which the plain MenuItem doesn't lay out. */
function AccountItem({ row, onSelect, trailing }: { row: Row; onSelect: () => void; trailing?: ReactNode }) {
  const signedOut = row.state === "signed-out";
  return (
    <DM.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-surface-2"
    >
      <Avatar name={row.displayName} email={row.email} size={28} dim={signedOut} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", signedOut && "text-fg-muted")}>{row.displayName || row.email}</span>
        <span className="block truncate text-xs text-fg-faint">{signedOut ? "Signed out · sign in again" : row.email}</span>
      </span>
      {trailing}
    </DM.Item>
  );
}

export function AccountMenu({ me }: { me: Me }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [theme, setTheme] = useTheme();
  const [managing, setManaging] = useState(false);
  const rows = useAccountRows(me);
  const others = rows.filter((r) => r.state !== "active");
  const signedInCount = rows.filter((r) => r.state !== "signed-out").length;
  const othersUnread = others.some((r) => (r.unread ?? 0) > 0);

  useEffect(() => watchAccountChanges(me.id, () => void qc.invalidateQueries({ queryKey: qk.accounts })), [me.id, qc]);

  const themeOptions: Array<{ v: ThemeSetting; label: string; icon: ReactNode }> = [
    { v: "system", label: "System", icon: <Monitor size={14} /> },
    { v: "light", label: "Light", icon: <Sun size={14} /> },
    { v: "dark", label: "Dark", icon: <Moon size={14} /> },
  ];

  const addAccount = async (email?: string) => {
    if (!(await prepareToLeave())) return;
    await navigate({ to: "/login", search: { add: true, ...(email ? { email } : {}) } });
  };

  const open = (row: Row) => (row.state === "signed-out" ? void addAccount(row.email) : void switchAccount(row.id));

  const signOutOf = async (which: { all?: boolean; mailboxId?: string }, forget: string[]) => {
    if (await signOut(me.id, which, forget)) await qc.invalidateQueries({ queryKey: qk.accounts });
  };

  return (
    <>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            className="focus-ring relative shrink-0 rounded-full ring-offset-2 ring-offset-bg transition-shadow hover:ring-2 hover:ring-border-strong"
            aria-label={othersUnread ? "Account menu (unread mail in another account)" : "Account menu"}
          >
            <Avatar name={me.displayName} email={me.email} />
            {othersUnread && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg" />}
          </button>
        }
      >
        <MenuLabel>
          <div className="flex items-center gap-2.5 py-0.5">
            <Avatar name={me.displayName} email={me.email} size={32} />
            <div className="min-w-0">
              <div className="truncate text-sm text-fg">{me.displayName}</div>
              <div className="truncate font-normal">{me.email}</div>
            </div>
          </div>
        </MenuLabel>
        <MenuSeparator />
        {others.length > 0 && <MenuLabel>Switch account</MenuLabel>}
        {others.map((row) => (
          <AccountItem key={row.id} row={row} onSelect={() => open(row)} trailing={<UnreadCount n={row.unread} />} />
        ))}
        <MenuItem icon={<UserPlus size={14} />} disabled={signedInCount >= MAX_ACCOUNTS} onSelect={() => void addAccount()}>
          {signedInCount >= MAX_ACCOUNTS ? `Add account (${MAX_ACCOUNTS} max)` : "Add account"}
        </MenuItem>
        {others.length > 0 && (
          <MenuItem icon={<Users size={14} />} onSelect={() => setManaging(true)}>
            Manage accounts
          </MenuItem>
        )}
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
        <MenuItem icon={<LogOut size={14} />} onSelect={() => void signOutOf({}, [me.id])}>
          {signedInCount > 1 ? "Sign out of this account" : "Sign out"}
        </MenuItem>
        {signedInCount > 1 && (
          <MenuItem icon={<LogOut size={14} />} onSelect={() => void signOutOf({ all: true }, rows.filter((r) => r.state !== "signed-out").map((r) => r.id))}>
            Sign out of all accounts
          </MenuItem>
        )}
      </Menu>

      <Dialog
        open={managing}
        onOpenChange={setManaging}
        title="Manage accounts"
        description="Mailboxes you can switch between on this browser. Signing out of one here keeps you in the others."
        footer={
          <>
            <Button variant="ghost" disabled={signedInCount >= MAX_ACCOUNTS} onClick={() => void addAccount()}>
              <UserPlus size={14} /> Add account
            </Button>
            <Button variant="primary" onClick={() => setManaging(false)}>
              Done
            </Button>
          </>
        }
      >
        <ul className="-mx-2 flex flex-col">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <Avatar name={row.displayName} email={row.email} size={36} dim={row.state === "signed-out"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{row.displayName || row.email}</span>
                  {row.state === "active" && <Badge tone="accent">Active</Badge>}
                  {row.state === "signed-out" && <Badge>Signed out</Badge>}
                </div>
                <div className="truncate text-xs text-fg-muted">{row.email}</div>
              </div>
              {row.state === "signed-in" && (
                <Button size="sm" variant="outline" onClick={() => void switchAccount(row.id)}>
                  Switch
                </Button>
              )}
              {row.state === "signed-out" ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => void addAccount(row.email)}>
                    Sign in
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => forgetAccounts([row.id])}>
                    Forget
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void signOutOf(row.state === "active" ? {} : { mailboxId: row.id }, [row.id])}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
