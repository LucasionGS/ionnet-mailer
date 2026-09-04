import { Hono } from "hono";
import { PasswordChangeSchema, ProfileUpdateSchema } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { parseJson } from "../http/validate.ts";
import { requireAuth } from "../http/middleware.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { destroyOtherSessions } from "../auth/session.ts";
import { toMe } from "../auth/routes.ts";
import { unauthorized } from "../errors.ts";

export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use("*", requireAuth);

accountRoutes.patch("/profile", async (c) => {
  const body = await parseJson(c, ProfileUpdateSchema);
  const user = c.get("user");
  if (body.displayName !== undefined) user.displayName = body.displayName;
  if (body.signature !== undefined) user.signature = body.signature;
  await user.save();
  return c.json(await toMe(user));
});

accountRoutes.post("/password", async (c) => {
  const body = await parseJson(c, PasswordChangeSchema);
  const user = c.get("user");
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw unauthorized("Current password is wrong");
  user.passwordHash = await hashPassword(body.newPassword);
  await user.save();
  await destroyOtherSessions(user.id, c.get("sessionId"));
  return c.json({ ok: true });
});
