import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { AuthSource } from "@ionnet/shared";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { failureReason, recordAuthEvent } from "./auth-events.ts";

const log = logger("dovecot-events");

/**
 * Dovecot posts its events to a URL carrying this token (see docker/dovecot/entrypoint.sh,
 * which derives the same value). Both sides already share the master password.
 */
export function dovecotEventsToken(): string {
  return createHash("sha256").update(`dovecot-events:${config.DOVECOT_MASTER_PASSWORD}`).digest("hex").slice(0, 40);
}

function tokenMatches(given: string): boolean {
  const want = Buffer.from(dovecotEventsToken());
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want);
}

const SOURCES: Record<string, AuthSource> = { imap: "imap", pop3: "pop3", smtp: "smtp", submission: "smtp", sieve: "sieve", managesieve: "sieve" };

interface DovecotEvent {
  event?: string;
  fields?: Record<string, unknown>;
}

async function handle(e: DovecotEvent): Promise<void> {
  if (e.event !== "auth_request_finished") return;
  const f = e.fields ?? {};
  const str = (k: string) => (typeof f[k] === "string" && f[k] ? (f[k] as string) : null);
  const protocol = str("protocol") ?? "";
  // Mailbox lookups for delivery and admin tools are not sign-ins.
  if (protocol === "lmtp" || protocol === "doveadm") return;
  // The web app's own IMAP connections (dovecot.conf filters these out already).
  if (str("master_user")) return;

  const username = str("original_user") ?? str("user");
  const success = f.success === "yes";
  const { reason, mailboxId } = success ? { reason: null, mailboxId: null } : await failureReason(username);
  await recordAuthEvent({
    source: SOURCES[protocol] ?? "other",
    username,
    ip: str("remote_ip"),
    success,
    reason,
    mailboxId,
    detail: [str("mechanism"), str("transport")].filter(Boolean).join(", ") || null,
  });
}

/** Served on INTERNAL_PORT, which is never published or proxied. */
export const internalApp = new Hono();

internalApp.post("/dovecot/events/:token", async (c) => {
  if (!tokenMatches(c.req.param("token"))) return c.body(null, 404);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.body(null, 400);
  }
  for (const e of Array.isArray(body) ? body : [body]) {
    try {
      await handle((e ?? {}) as DovecotEvent);
    } catch (err) {
      log.warn(`could not handle event: ${(err as Error).message}`);
    }
  }
  return c.body(null, 204);
});

internalApp.all("*", (c) => c.body(null, 404));
