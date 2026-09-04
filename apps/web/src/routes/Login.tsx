import { useState, type FormEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { APP_NAME } from "@ionnet/shared";
import { useLogin } from "@/lib/queries";
import { errorMessage, isApiError } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      const target = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/mail/INBOX";
      await navigate({ to: target });
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

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Mail size={20} />
          </div>
          <div>
            <div className="text-lg font-semibold">{APP_NAME}</div>
            <div className="text-xs text-fg-muted">Sign in with your mailbox</div>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border bg-surface p-6 shadow-sm">
          <Field label="Email address" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
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
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
