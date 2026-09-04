import { Hono } from "hono";
import { LoginRequestSchema, type Me } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { parseJson } from "../http/validate.ts";
import { MailboxRow, Domain } from "../db/models.ts";
import { verifyPassword } from "./password.ts";
import { createSession, destroySession } from "./session.ts";
import { clearFailures, isLocked, recordFailure } from "./ratelimit.ts";
import { requireAuth } from "../http/middleware.ts";
import { tooMany, unauthorized } from "../errors.ts";

export async function toMe(user: MailboxRow): Promise<Me> {
  const domain = await Domain.findByPk(user.domainId);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    domain: domain?.name ?? user.email.split("@")[1] ?? "",
    isAdmin: user.isAdmin,
    signature: user.signature ?? null,
    quotaBytes: Number(user.quotaBytes),
  };
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const { email, password } = await parseJson(c, LoginRequestSchema);
  const ip = c.get("clientIp");

  const [ipLock, userLock] = await Promise.all([isLocked("ip", ip), isLocked("user", email)]);
  const lock = Math.max(ipLock, userLock);
  if (lock > 0) throw tooMany("Too many failed attempts. Try again later.", { retryAfterSeconds: lock });

  const user = await MailboxRow.findOne({ where: { email } });
  const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    const [a, b] = await Promise.all([recordFailure("ip", ip), recordFailure("user", email)]);
    const locked = Math.max(a, b);
    if (locked) throw tooMany("Too many failed attempts. Try again later.", { retryAfterSeconds: locked });
    throw unauthorized("Wrong email address or password");
  }

  await Promise.all([clearFailures("ip", ip), clearFailures("user", email)]);
  await createSession(c, user.id, ip);
  return c.json(await toMe(user));
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => c.json(await toMe(c.get("user"))));
