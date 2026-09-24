import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Mail, X } from "lucide-react";
import { APP_NAME } from "@ionnet/shared";
import { useAccounts, useLogin } from "@/lib/queries";
import { forgetAccounts, useRememberedAccounts } from "@/lib/accounts";
import { errorMessage, isApiError } from "@/lib/api";
import { avatarColor, cn, initials } from "@/lib/utils";
import { Button, Field, Input } from "@/components/ui";
import { signedIn, switchAccount } from "@/features/account/switching";

/**
 * Accounts to pick from above the form: ones still signed in on this browser (when the active one's session ended,
 * the others are one click away) and remembered ones whose session ended, which fill in the email address.
 */
function AccountPicker({ adding, onPick }: { adding: boolean; onPick: (email: string) => void }) {
  const { data: live } = useAccounts();
  const remembered = useRememberedAccounts();
  const stillIn = adding ? [] : (live ?? []);
  const signedOut = remembered.filter((r) => !(live ?? []).some((a) => a.id === r.id));
  if (!stillIn.length && !signedOut.length) return null;

  const row = (key: string, name: string, email: string, hint: string, onClick: () => void, onForget?: () => void) => (
    <li key={key} className="group relative">
      <button type="button" onClick={onClick} className="focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2">
        <span
          className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", onForget && "opacity-45 grayscale")}
          style={{ background: avatarColor(email) }}
          aria-hidden
        >
          {initials(name || email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name || email}</span>
          <span className="block truncate text-xs text-fg-muted">{hint}</span>
        </span>
        {!onForget && <ChevronRight size={16} className="text-fg-faint" />}
      </button>
      {onForget && (
        <button
          type="button"
          aria-label={`Forget ${email}`}
          onClick={onForget}
          className="focus-ring absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg focus:opacity-100"
        >
          <X size={14} />
        </button>
      )}
    </li>
  );

  return (
    <div className="mb-4 rounded-xl border bg-surface p-2 shadow-sm">
      <div className="px-3 pt-1 pb-1.5 text-xs font-medium text-fg-faint">{stillIn.length ? "Choose an account" : "Sign in again"}</div>
      <ul className="flex flex-col">
        {stillIn.map((a) => row(a.id, a.displayName, a.email, `${a.email} · signed in`, () => void switchAccount(a.id)))}
        {signedOut.map((a) =>
          row(a.id, a.displayName, a.email, a.email, () => onPick(a.email), () => forgetAccounts([a.id])),
        )}
      </ul>
    </div>
  );
}

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const adding = !!search.add;
  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const me = await login.mutateAsync({ email, password });
      signedIn(me);
      const target = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/mail/INBOX";
      // The app still holds the previous account's data; start clean as the new one.
      if (adding) window.location.assign(target);
      else await navigate({ to: target });
    } catch (err) {
      if (isApiError(err) && err.status === 429) {
        setError(err.message || "Too many failed attempts. Please wait a few minutes and try again.");
      } else if (isApiError(err) && err.status === 401) {
        setError("Incorrect email or password.");
      } else {
        setError(errorMessage(err));
      }
    }
  };

  const pick = (address: string) => {
    setEmail(address);
    setError(null);
    passwordRef.current?.focus();
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm animate-fade-in">
        {adding && (
          <Link to="/mail/$folder" params={{ folder: "INBOX" }} className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-md text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={15} /> Back to mail
          </Link>
        )}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Mail size={20} />
          </div>
          <div>
            <div className="text-lg font-semibold">{adding ? "Add an account" : APP_NAME}</div>
            <div className="text-xs text-fg-muted">{adding ? "You stay signed in to your other mailboxes" : "Sign in with your mailbox"}</div>
          </div>
        </div>
        <AccountPicker adding={adding} onPick={pick} />
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border bg-surface p-6 shadow-sm">
          <Field label="Email address" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus={!search.email}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              ref={passwordRef}
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus={!!search.email}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" loading={login.isPending} className="mt-1">
            {adding ? "Add account" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
