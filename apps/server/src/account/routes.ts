import { Hono } from "hono";
import { PasswordChangeSchema, ProfileUpdateSchema, RemoteContentSenderSchema } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { parseJson, parseWith } from "../http/validate.ts";
import { requireAuth } from "../http/middleware.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { destroyOtherSessions } from "../auth/session.ts";
import { toMe } from "../auth/routes.ts";
import { badRequest, unauthorized } from "../errors.ts";
import { audit } from "../activity/audit.ts";
import { sequelize } from "../db/sequelize.ts";

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
  await audit(c, "account.password_change", user.email);
  return c.json({ ok: true });
});

const MAX_REMOTE_CONTENT_ALLOW = 1000;

// Edited in SQL so two tabs adding senders at once don't overwrite each other.
accountRoutes.put("/remote-content/:sender", async (c) => {
  const sender = parseWith(RemoteContentSenderSchema, c.req.param("sender"));
  const user = c.get("user");
  await sequelize.query(
    `UPDATE mailboxes SET remote_content_allow = array_append(remote_content_allow, :sender)
     WHERE id = :id AND NOT (:sender = ANY(remote_content_allow)) AND cardinality(remote_content_allow) < :max`,
    { replacements: { id: user.id, sender, max: MAX_REMOTE_CONTENT_ALLOW } },
  );
  await user.reload();
  if (!user.remoteContentAllow.includes(sender)) throw badRequest(`At most ${MAX_REMOTE_CONTENT_ALLOW} allowed senders`);
  return c.json(await toMe(user));
});

accountRoutes.delete("/remote-content/:sender", async (c) => {
  const sender = c.req.param("sender").trim().toLowerCase();
  const user = c.get("user");
  await sequelize.query("UPDATE mailboxes SET remote_content_allow = array_remove(remote_content_allow, :sender) WHERE id = :id", {
    replacements: { id: user.id, sender },
  });
  await user.reload();
  return c.json(await toMe(user));
});
