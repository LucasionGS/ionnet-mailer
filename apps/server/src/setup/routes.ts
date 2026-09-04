import { Hono } from "hono";
import { z } from "zod";
import {
  SetupCreateRequestSchema,
  SetupHostnameCheckRequestSchema,
  type SetupStatus,
} from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { parseJson } from "../http/validate.ts";
import { config } from "../config.ts";
import { forbidden, notFound } from "../errors.ts";
import { getPublicIp } from "../dns/publicip.ts";
import { checkHostname, checkDomainDns } from "../dns/check.ts";
import { isSetupCompleted, markSetupCompleted, verifySetupToken } from "./token.ts";
import { afterDomainCommit, createDomain, createMailbox, requireDomain, sequelize } from "../admin/service.ts";
import { setSetting } from "../db/models.ts";
import { createSession } from "../auth/session.ts";
import { logger } from "../logger.ts";

const log = logger("setup");
export const setupRoutes = new Hono<AppEnv>();

// The status endpoint stays available forever (the web app uses it for routing);
// every other setup route disappears once setup has completed.
setupRoutes.use("*", async (c, next) => {
  if (c.req.path.endsWith("/status") && c.req.method === "GET") return next();
  if (await isSetupCompleted()) throw notFound("Setup is already complete");
  await next();
});

const requireToken = async (c: Parameters<Parameters<typeof setupRoutes.use>[1]>[0], next: () => Promise<void>) => {
  const token = c.req.header("x-setup-token") ?? "";
  if (!(await verifySetupToken(token))) throw forbidden("Invalid setup token. Find it in the server logs: docker compose logs app");
  await next();
};

setupRoutes.get("/status", async (c) => {
  const status: SetupStatus = {
    completed: await isSetupCompleted(),
    hostname: config.MAIL_HOSTNAME,
    publicIp: await getPublicIp(),
    version: config.version,
  };
  return c.json(status);
});

setupRoutes.post("/verify-token", async (c) => {
  const { token } = await parseJson(c, z.object({ token: z.string().min(1) }));
  if (!(await verifySetupToken(token))) throw forbidden("Invalid setup token");
  return c.json({ ok: true });
});

setupRoutes.post("/check-hostname", requireToken, async (c) => {
  const { hostname } = await parseJson(c, SetupHostnameCheckRequestSchema);
  return c.json(await checkHostname(hostname));
});

setupRoutes.post("/create", requireToken, async (c) => {
  const body = await parseJson(c, SetupCreateRequestSchema);
  const result = await sequelize.transaction(async (tx) => {
    const domain = await createDomain(body.domain, tx);
    const admin = await createMailbox(
      domain,
      {
        localPart: body.adminLocalPart,
        displayName: body.adminDisplayName,
        password: body.adminPassword,
        quotaBytes: 0,
        isAdmin: true,
      },
      tx,
    );
    return { domain, admin };
  });
  await afterDomainCommit(result.domain);
  await setSetting("hostname", body.hostname);
  if (body.hostname !== config.MAIL_HOSTNAME) {
    log.warn(`hostname entered in wizard (${body.hostname}) differs from MAIL_HOSTNAME (${config.MAIL_HOSTNAME}); update .env and restart`);
  }
  // Log the admin in right away so the wizard can continue as an authenticated user.
  await createSession(c, result.admin.id, c.get("clientIp"));
  return c.json({ domainId: result.domain.id, mailboxId: result.admin.id }, 201);
});

setupRoutes.get("/dns/:domainId", requireToken, async (c) => {
  const domain = await requireDomain(c.req.param("domainId"));
  return c.json(await checkDomainDns(domain));
});

setupRoutes.post("/finish", requireToken, async (c) => {
  await markSetupCompleted();
  log.info("setup completed");
  return c.json({ ok: true });
});
