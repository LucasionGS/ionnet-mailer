import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Op } from "sequelize";
import { config } from "../config.ts";
import { MailboxRow, Session } from "../db/models.ts";

export const COOKIE = "ionnet_session";
const TTL_MS = 30 * 24 * 3600 * 1000;
const REFRESH_AFTER_MS = 24 * 3600 * 1000;

export async function createSession(c: Context, mailboxId: string, ip: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await Session.create({
    id,
    mailboxId,
    expiresAt: new Date(Date.now() + TTL_MS),
    ip,
    userAgent: (c.req.header("user-agent") ?? "").slice(0, 512) || null,
  });
  setCookie(c, COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: !config.isDev,
    path: "/",
    maxAge: TTL_MS / 1000,
  });
  return id;
}

export async function loadSession(c: Context): Promise<{ session: Session; user: MailboxRow } | null> {
  const id = getCookie(c, COOKIE);
  if (!id) return null;
  const session = await Session.findByPk(id);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await session.destroy();
    deleteCookie(c, COOKIE, { path: "/" });
    return null;
  }
  const user = await MailboxRow.findByPk(session.mailboxId);
  if (!user || !user.active) return null;
  // Sliding expiry: extend at most once a day to keep writes low.
  if (session.expiresAt.getTime() - Date.now() < TTL_MS - REFRESH_AFTER_MS) {
    session.expiresAt = new Date(Date.now() + TTL_MS);
    await session.save();
    setCookie(c, COOKIE, id, { httpOnly: true, sameSite: "Lax", secure: !config.isDev, path: "/", maxAge: TTL_MS / 1000 });
  }
  return { session, user };
}

export async function destroySession(c: Context): Promise<void> {
  const id = getCookie(c, COOKIE);
  if (id) await Session.destroy({ where: { id } });
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function destroyOtherSessions(mailboxId: string, keep: string): Promise<void> {
  await Session.destroy({ where: { mailboxId, id: { [Op.ne]: keep } } });
}

export async function purgeExpiredSessions(): Promise<void> {
  await Session.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
}
