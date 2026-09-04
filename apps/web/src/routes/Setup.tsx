import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, CircleAlert, Globe, KeyRound, Mail, PartyPopper, Server, TriangleAlert, UserRound } from "lucide-react";
import type { DnsCheckResult, SetupHostnameCheckResult } from "@ionnet/shared";
import { APP_NAME } from "@ionnet/shared";
import { setupApi, useSetupStatus, qk } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn, passwordStrength } from "@/lib/utils";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { DnsRecords } from "@/components/DnsRecords";

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ["Welcome", "Hostname", "Domain & admin", "DNS records", "Done"];

function StepIndicator({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
              i < step ? "bg-success text-white" : i === step ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-faint",
            )}
          >
            {i < step ? <Check size={12} /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium text-fg" : "text-fg-muted")}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border-strong" />}
        </li>
      ))}
    </ol>
  );
}

function Callout({ tone, children }: { tone: "ok" | "warn" | "info"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "border-success/40 bg-success-soft" : tone === "warn" ? "border-warning/40 bg-warning-soft" : "border-border bg-surface-2";
  const Icon = tone === "ok" ? Check : tone === "warn" ? TriangleAlert : CircleAlert;
  return (
    <div className={cn("flex items-start gap-2 rounded-md border p-3 text-xs", cls)}>
      <Icon size={14} className={cn("mt-0.5 shrink-0", tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-fg-muted")} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SetupPage() {
  const { data: status, isLoading } = useSetupStatus();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [hostname, setHostname] = useState("");
  const [hostCheck, setHostCheck] = useState<SetupHostnameCheckResult | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);

  const [domain, setDomain] = useState("");
  const [localPart, setLocalPart] = useState("admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);

  const [dns, setDns] = useState<DnsCheckResult | null>(null);
  const [dnsBusy, setDnsBusy] = useState(false);

  useEffect(() => {
    if (status && !hostname) {
      setHostname(status.hostname);
      const parts = status.hostname.split(".");
      if (parts.length >= 3) setDomain(parts.slice(1).join("."));
      else setDomain(status.hostname);
    }
  }, [status, hostname]);

  if (isLoading || !status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  const verifyToken = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTokenError(null);
    try {
      await setupApi.verifyToken(token.trim());
      setStep(1);
    } catch (err) {
      setTokenError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const checkHost = async () => {
    setBusy(true);
    setHostError(null);
    setHostCheck(null);
    try {
      setHostCheck(await setupApi.checkHostname(token.trim(), hostname.trim().toLowerCase()));
    } catch (err) {
      setHostError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (password !== confirm) {
      setCreateError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await setupApi.create(token.trim(), {
        hostname: hostname.trim().toLowerCase(),
        domain: domain.trim().toLowerCase(),
        adminLocalPart: localPart.trim().toLowerCase(),
        adminDisplayName: displayName.trim(),
        adminPassword: password,
      });
      setDomainId(r.domainId);
      setStep(3);
      setDnsBusy(true);
      try {
        setDns(await setupApi.dns(token.trim(), r.domainId));
      } finally {
        setDnsBusy(false);
      }
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const refreshDns = async () => {
    if (!domainId) return;
    setDnsBusy(true);
    try {
      setDns(await setupApi.dns(token.trim(), domainId, true));
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setDnsBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await setupApi.finish(token.trim());
      await qc.invalidateQueries({ queryKey: qk.setupStatus });
      setStep(4);
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const strength = passwordStrength(password);

  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Mail size={20} />
          </div>
          <div>
            <div className="text-lg font-semibold">{APP_NAME} setup</div>
            <div className="text-xs text-fg-muted">A few steps and your mail server is ready.</div>
          </div>
        </div>
        <StepIndicator step={step} />

        <div className="animate-fade-in rounded-xl border bg-surface p-6 shadow-sm" key={step}>
          {step === 0 && (
            <form onSubmit={verifyToken} className="flex flex-col gap-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <KeyRound size={18} className="text-accent" /> Welcome
                </h2>
                <p className="mt-2 text-sm text-fg-muted">
                  To make sure only you can set up this server, enter the one-time setup token. It is printed in the
                  application container's log at startup. Run:
                </p>
                <pre className="mt-2 rounded-md bg-surface-2 p-3 font-mono text-xs">docker compose logs app | grep -A2 "SETUP TOKEN"</pre>
              </div>
              <Field label="Setup token" error={tokenError}>
                <Input autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the token" required className="font-mono" />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={busy}>
                  Continue <ArrowRight size={14} />
                </Button>
              </div>
            </form>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Server size={18} className="text-accent" /> Server hostname
                </h2>
                <p className="mt-2 text-sm text-fg-muted">
                  This is the name other mail servers will see, for example <code className="font-mono">mail.example.com</code>. It
                  needs an <b>A record</b> pointing at this server's public IP, and a <b>PTR (reverse DNS)</b> record set at your
                  hosting provider pointing back at the same name. Both are required for other providers to trust your mail.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <Field label="Hostname" className="flex-1">
                  <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="mail.example.com" />
                </Field>
                <Button variant="outline" onClick={checkHost} loading={busy}>
                  Check
                </Button>
              </div>
              {status.publicIp && (
                <div className="text-xs text-fg-muted">
                  Detected public IP: <code className="font-mono text-fg">{status.publicIp}</code>
                </div>
              )}
              {hostError && <Callout tone="warn">{hostError}</Callout>}
              {hostCheck && (
                <div className="flex flex-col gap-2">
                  <Callout tone={hostCheck.aMatches ? "ok" : "warn"}>
                    <b>A record:</b>{" "}
                    {hostCheck.aRecords.length
                      ? `${hostCheck.hostname} → ${hostCheck.aRecords.join(", ")}`
                      : "not found"}
                    {!hostCheck.aMatches && (
                      <div className="mt-1">
                        Create an A record for <code className="font-mono">{hostCheck.hostname}</code> pointing at{" "}
                        <code className="font-mono">{hostCheck.publicIp ?? "this server's IP"}</code>.
                      </div>
                    )}
                  </Callout>
                  <Callout tone={hostCheck.ptrMatches ? "ok" : "warn"}>
                    <b>Reverse DNS (PTR):</b> {hostCheck.ptr.length ? hostCheck.ptr.join(", ") : "not set"}
                    {!hostCheck.ptrMatches && (
                      <div className="mt-1">
                        In your VPS provider's control panel, set the reverse DNS of{" "}
                        <code className="font-mono">{hostCheck.publicIp ?? "your IP"}</code> to{" "}
                        <code className="font-mono">{hostCheck.hostname}</code>. This is often under "Networking" or "IP addresses".
                      </div>
                    )}
                  </Callout>
                  {hostCheck.warnings.map((w, i) => (
                    <Callout key={i} tone="info">
                      {w}
                    </Callout>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="primary" onClick={() => setStep(2)} disabled={!hostname.trim()}>
                  {hostCheck && hostCheck.aMatches && hostCheck.ptrMatches ? "Continue" : "Continue anyway"} <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <form onSubmit={create} className="flex flex-col gap-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Globe size={18} className="text-accent" /> First domain and admin account
                </h2>
                <p className="mt-2 text-sm text-fg-muted">
                  The domain is the part after the @ in your email addresses. You can add more domains later.
                </p>
              </div>
              <Field label="Email domain">
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
              </Field>
              <div className="border-t pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <UserRound size={15} className="text-fg-muted" /> Admin mailbox
                </h3>
                <p className="mt-1 text-xs text-fg-muted">This account logs in to manage the server and also receives mail.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email address">
                  <div className="flex items-center">
                    <Input value={localPart} onChange={(e) => setLocalPart(e.target.value)} required className="rounded-r-none" />
                    <span className="flex h-8.5 items-center rounded-r-md border border-l-0 border-border-strong bg-surface-2 px-2 text-xs text-fg-muted">
                      @{domain || "domain"}
                    </span>
                  </div>
                </Field>
                <Field label="Display name">
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" required />
                </Field>
                <Field
                  label="Password"
                  hint={
                    password ? (
                      <span className="flex items-center gap-2">
                        <span className="flex gap-0.5">
                          {[1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className={cn(
                                "h-1 w-6 rounded-full",
                                i <= strength.score ? (strength.score >= 3 ? "bg-success" : strength.score === 2 ? "bg-warning" : "bg-danger") : "bg-surface-3",
                              )}
                            />
                          ))}
                        </span>
                        {strength.label}
                      </span>
                    ) : (
                      "At least 10 characters"
                    )
                  }
                >
                  <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
                </Field>
                <Field label="Confirm password" error={confirm && confirm !== password ? "Passwords do not match" : undefined}>
                  <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </Field>
              </div>
              {createError && <Callout tone="warn">{createError}</Callout>}
              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  Create <ArrowRight size={14} />
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-5">
              <div>
                <h2 className="text-base font-semibold">DNS records for {domain}</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  Log in to the DNS provider for <b>{domain}</b> (where you bought the domain, or wherever its nameservers are)
                  and add the records below. Use the copy buttons to avoid typos. Once you've added them, click <b>Re-check</b>.
                  You can also finish now and come back to this under Admin → Domains → DNS.
                </p>
              </div>
              {dnsBusy && !dns ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Spinner /> Checking DNS…
                </div>
              ) : (
                <DnsRecords result={dns ?? undefined} onRefresh={refreshDns} refreshing={dnsBusy} />
              )}
              {createError && <Callout tone="warn">{createError}</Callout>}
              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={finish} loading={busy}>
                  I'll do this later
                </Button>
                <Button variant="primary" onClick={finish} loading={busy}>
                  Finish setup <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
                <PartyPopper size={26} />
              </div>
              <h2 className="text-lg font-semibold">You're all set</h2>
              <p className="max-w-md text-sm text-fg-muted">
                Sign in as <b>{localPart}@{domain}</b> to open your inbox. Add more mailboxes and domains from the Admin
                section.
              </p>
              <Link to="/login">
                <Button variant="primary" size="lg">
                  Go to sign in <ArrowRight size={14} />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
