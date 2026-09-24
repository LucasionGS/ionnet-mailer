import type { MiddlewareHandler } from "hono";
import { ACCOUNT_HEADER } from "@ionnet/shared";
import type { AppEnv } from "./types.ts";
import { loadSession } from "../auth/session.ts";
import { clientIp } from "./client-ip.ts";
import { HttpError, forbidden, unauthorized } from "../errors.ts";

export const attachClientIp: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("clientIp", clientIp(c));
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const loaded = await loadSession(c);
  if (!loaded) throw unauthorized();
  // The web client names the account it thinks is active; if another tab switched since, refuse rather than act as
  // the wrong mailbox (e.g. send a message from it).
  const expected = c.req.header(ACCOUNT_HEADER);
  if (expected && expected !== loaded.user.id) throw new HttpError(409, "account_changed", "You switched to another account in a different tab");
  c.set("user", loaded.user);
  c.set("sessionId", loaded.session.id);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")?.isAdmin) throw forbidden("Administrator access required");
  await next();
};
