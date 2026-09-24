import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { LoginRequestSchema, LogoutRequestSchema, MAX_ACCOUNTS, SwitchAccountRequestSchema, type Account, type LogoutResult, type Me } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { parseJson, parseWith } from "../http/validate.ts";
import { MailboxRow, Domain } from "../db/models.ts";
import { hashPassword, needsRehash, verifyPassword } from "./password.ts";
import { COOKIE, createSession, destroySession, loadAccounts, switchSession } from "./session.ts";
import { clearFailures, isLocked, recordFailure } from "./ratelimit.ts";
import { requireAuth } from "../http/middleware.ts";
import { badRequest, notFound, tooMany, unauthorized } from "../errors.ts";
import { pool } from "../mail/pool.ts";
import { logger } from "../logger.ts";

const log = logger("auth");
import { allowedSenders } from "../send/senders.ts";
import { recordAuthEvent } from "../activity/auth-events.ts";

export async function toMe(user: MailboxRow): Promise<Me> {
  const [domain, sendAs] = await Promise.all([Domain.findByPk(user.domainId), allowedSenders(user)]);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    domain: domain?.name ?? user.email.split("@")[1] ?? "",
    isAdmin: user.isAdmin,
    signature: user.signature ?? null,
    quotaBytes: Number(user.quotaBytes),
    sendAs,
  };
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const { email, password } = await parseJson(c, LoginRequestSchema);
  const ip = c.get("clientIp");

  const userAgent = c.req.header("user-agent") ?? null;
  const attempt = { source: "web" as const, username: email, ip, userAgent };

  const [ipLock, userLock] = await Promise.all([isLocked("ip", ip), isLocked("user", email)]);
  const lock = Math.max(ipLock, userLock);
  if (lock > 0) {
    await recordAuthEvent({ ...attempt, success: false, reason: "locked" });
    throw tooMany("Too many failed attempts. Try again later.", { retryAfterSeconds: lock });
  }

  const user = await MailboxRow.findOne({ where: { email } });
  const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    const reason = !user ? "unknown_user" : !user.active ? "disabled" : "wrong_password";
    await recordAuthEvent({ ...attempt, success: false, reason, mailboxId: user?.id ?? null });
    const [a, b] = await Promise.all([recordFailure("ip", ip), recordFailure("user", email)]);
    const locked = Math.max(a, b);
    if (locked) throw tooMany("Too many failed attempts. Try again later.", { retryAfterSeconds: locked });
    throw unauthorized("Wrong email address or password");
  }

  await Promise.all([clearFailures("ip", ip), clearFailures("user", email)]);
  const signedIn = await loadAccounts(c);
  if (signedIn.length >= MAX_ACCOUNTS && !signedIn.some((a) => a.user.id === user.id)) {
    throw badRequest(`You can be signed in to at most ${MAX_ACCOUNTS} mailboxes at once. Sign out of one first.`);
  }
  // Imported accounts may carry a legacy hash (e.g. SHA512-CRYPT); upgrade it now that we know the password.
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(password);
    await user.save();
  }
  await createSession(c, user.id, ip);
  await recordAuthEvent({ ...attempt, success: true, mailboxId: user.id });
  return c.json(await toMe(user));
});

authRoutes.post("/logout", async (c) => {
  // The body is optional: a bare POST signs out the active account only.
  const raw: unknown = await c.req.json().catch(() => ({}));
  const active = await destroySession(c, parseWith(LogoutRequestSchema, raw ?? {}));
  return c.json({ ok: true, active: active ? await toMe(active) : null } satisfies LogoutResult);
});

async function inboxUnread(user: MailboxRow, ip: string): Promise<number | null> {
  try {
    const status = await pool.withClient(user, (client) => client.status("INBOX", { unseen: true }), ip);
    return status.unseen ?? null;
  } catch (err) {
    log.debug(`unread count for ${user.email} failed: ${(err as Error).message}`);
    return null;
  }
}

/** Works without an active session too, so the sign-in page can offer the accounts that are still signed in. */
authRoutes.get("/accounts", async (c) => {
  const accounts = await loadAccounts(c);
  const active = accounts.find((a) => a.session.id === getCookie(c, COOKIE));
  const ip = c.get("clientIp");
  const list: Account[] = await Promise.all(
    accounts.map(async ({ user }) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      active: user.id === active?.user.id,
      unread: await inboxUnread(user, ip),
    })),
  );
  return c.json(list);
});

authRoutes.post("/switch", async (c) => {
  const { mailboxId } = await parseJson(c, SwitchAccountRequestSchema);
  const user = await switchSession(c, mailboxId);
  if (!user) throw notFound("That mailbox is not signed in on this browser any more");
  return c.json(await toMe(user));
});

authRoutes.get("/me", requireAuth, async (c) => c.json(await toMe(c.get("user"))));
