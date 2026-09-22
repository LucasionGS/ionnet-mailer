import { Hono } from "hono";
import { LoginRequestSchema, type Me } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { parseJson } from "../http/validate.ts";
import { MailboxRow, Domain } from "../db/models.ts";
import { hashPassword, needsRehash, verifyPassword } from "./password.ts";
import { createSession, destroySession } from "./session.ts";
import { clearFailures, isLocked, recordFailure } from "./ratelimit.ts";
import { requireAuth } from "../http/middleware.ts";
import { tooMany, unauthorized } from "../errors.ts";
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
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => c.json(await toMe(c.get("user"))));
