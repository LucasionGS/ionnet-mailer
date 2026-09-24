import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Op } from "sequelize";
import { config } from "../config.ts";
import { MailboxRow, Session } from "../db/models.ts";

/** The active session: every authenticated request runs as its mailbox. */
export const COOKIE = "ionnet_session";
/**
 * Every session this browser holds, the active one included, in sign-in order. It lets one browser stay signed in
 * to several mailboxes and switch between them; ids are base64url, so "." is a safe separator.
 */
const ACCOUNTS_COOKIE = "ionnet_accounts";
const TTL_MS = 30 * 24 * 3600 * 1000;
const REFRESH_AFTER_MS = 24 * 3600 * 1000;
/** A crafted cookie must not turn into an unbounded lookup. */
const MAX_COOKIE_IDS = 16;

export interface SignedIn {
  session: Session;
  user: MailboxRow;
}

const cookieOptions = () => ({ httpOnly: true, sameSite: "Lax" as const, secure: !config.isDev, path: "/", maxAge: TTL_MS / 1000 });

function setActive(c: Context, id: string | null) {
  if (id) setCookie(c, COOKIE, id, cookieOptions());
  else deleteCookie(c, COOKIE, { path: "/" });
}

function readIds(c: Context): string[] {
  const ids = (getCookie(c, ACCOUNTS_COOKIE) ?? "").split(".").filter(Boolean);
  // Sessions from before multi-account sign-in only have the active cookie.
  const active = getCookie(c, COOKIE);
  if (active && !ids.includes(active)) ids.push(active);
  return [...new Set(ids)].slice(0, MAX_COOKIE_IDS);
}

function writeIds(c: Context, ids: string[]) {
  if (ids.length) setCookie(c, ACCOUNTS_COOKIE, ids.join("."), cookieOptions());
  else deleteCookie(c, ACCOUNTS_COOKIE, { path: "/" });
}

/** The live sessions among `ids`, one per mailbox, in the order given. */
async function resolve(ids: string[]): Promise<SignedIn[]> {
  if (!ids.length) return [];
  const sessions = await Session.findAll({ where: { id: ids, expiresAt: { [Op.gt]: new Date() } } });
  const users = sessions.length ? await MailboxRow.findAll({ where: { id: sessions.map((s) => s.mailboxId), active: true } }) : [];
  const out: SignedIn[] = [];
  for (const id of ids) {
    const session = sessions.find((s) => s.id === id);
    const user = session && users.find((u) => u.id === session.mailboxId);
    if (session && user && !out.some((a) => a.user.id === user.id)) out.push({ session, user });
  }
  return out;
}

export async function createSession(c: Context, mailboxId: string, ip: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await Session.create({
    id,
    mailboxId,
    expiresAt: new Date(Date.now() + TTL_MS),
    ip,
    userAgent: (c.req.header("user-agent") ?? "").slice(0, 512) || null,
  });
  // Signing in again to a mailbox this browser already holds replaces its old session.
  const ids = readIds(c);
  const replaced = ids.length ? await Session.findAll({ where: { id: ids, mailboxId }, attributes: ["id"] }) : [];
  if (replaced.length) await Session.destroy({ where: { id: replaced.map((s) => s.id) } });
  writeIds(c, [...ids.filter((x) => !replaced.some((s) => s.id === x)), id]);
  setActive(c, id);
  return id;
}

export async function loadSession(c: Context): Promise<SignedIn | null> {
  const id = getCookie(c, COOKIE);
  if (!id) return null;
  const session = await Session.findByPk(id);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await session.destroy();
    setActive(c, null);
    return null;
  }
  const user = await MailboxRow.findByPk(session.mailboxId);
  if (!user || !user.active) return null;
  // Sliding expiry: extend at most once a day to keep writes low.
  if (session.expiresAt.getTime() - Date.now() < TTL_MS - REFRESH_AFTER_MS) {
    session.expiresAt = new Date(Date.now() + TTL_MS);
    await session.save();
    setActive(c, id);
    writeIds(c, readIds(c));
  }
  return { session, user };
}

/**
 * Every mailbox signed in on this browser. Sessions that expired or were revoked drop out of the cookie, and the
 * rest get the same sliding expiry as the active one, so accounts you switch between stay remembered.
 */
export async function loadAccounts(c: Context): Promise<SignedIn[]> {
  const ids = readIds(c);
  const accounts = await resolve(ids);
  const kept = accounts.map((a) => a.session.id);
  const stale = accounts.filter((a) => a.session.expiresAt.getTime() - Date.now() < TTL_MS - REFRESH_AFTER_MS);
  if (stale.length) {
    await Session.update({ expiresAt: new Date(Date.now() + TTL_MS) }, { where: { id: stale.map((a) => a.session.id) } });
  }
  if (stale.length || kept.join(".") !== ids.join(".")) writeIds(c, kept);
  return accounts;
}

/** Makes `mailboxId` the active account, if this browser is signed in to it. */
export async function switchSession(c: Context, mailboxId: string): Promise<MailboxRow | null> {
  const hit = (await loadAccounts(c)).find((a) => a.user.id === mailboxId);
  if (!hit) return null;
  setActive(c, hit.session.id);
  return hit.user;
}

/**
 * Signs out the active account, the account `mailboxId`, or with `all` every account on this browser. Returns the
 * account that is active afterwards: when the active one leaves, the next signed-in account takes over.
 */
export async function destroySession(c: Context, which: { all?: boolean; mailboxId?: string } = {}): Promise<MailboxRow | null> {
  const signedIn = await resolve(readIds(c));
  const active = getCookie(c, COOKIE);
  let doomed: string[];
  if (which.all) doomed = readIds(c);
  else if (which.mailboxId) doomed = signedIn.filter((a) => a.user.id === which.mailboxId).map((a) => a.session.id);
  else doomed = active ? [active] : [];
  if (doomed.length) await Session.destroy({ where: { id: doomed } });
  const rest = signedIn.filter((a) => !doomed.includes(a.session.id));
  writeIds(c, rest.map((a) => a.session.id));
  const next = rest.find((a) => a.session.id === active) ?? rest[0] ?? null;
  setActive(c, next?.session.id ?? null);
  return next?.user ?? null;
}

export async function destroyOtherSessions(mailboxId: string, keep: string): Promise<void> {
  await Session.destroy({ where: { mailboxId, id: { [Op.ne]: keep } } });
}

export async function purgeExpiredSessions(): Promise<void> {
  await Session.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
}
