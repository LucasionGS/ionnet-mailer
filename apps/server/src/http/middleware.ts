import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.ts";
import { loadSession } from "../auth/session.ts";
import { clientIp } from "./client-ip.ts";
import { forbidden, unauthorized } from "../errors.ts";

export const attachClientIp: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("clientIp", clientIp(c));
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const loaded = await loadSession(c);
  if (!loaded) throw unauthorized();
  c.set("user", loaded.user);
  c.set("sessionId", loaded.session.id);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")?.isAdmin) throw forbidden("Administrator access required");
  await next();
};
