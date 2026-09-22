import { Hono } from "hono";
import {
  AliasCreateSchema,
  AliasUpdateSchema,
  AuthSourceSchema,
  DomainCreateSchema,
  DomainUpdateSchema,
  LogLevelSchema,
  LogSourceSchema,
  MailboxCreateSchema,
  MailboxUpdateSchema,
  MailDirectionSchema,
  MailLogStatusSchema,
  OverviewRangeSchema,
  QueueActionSchema,
} from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { requireAdmin, requireAuth } from "../http/middleware.ts";
import { parseJson } from "../http/validate.ts";
import { AliasRow, Domain, MailboxRow } from "../db/models.ts";
import { badRequest, notFound } from "../errors.ts";
import { listLockouts, removeLockout } from "../auth/ratelimit.ts";
import { cachedDomainDns } from "../dns/check.ts";
import { syncSelectorMap } from "./dkim.ts";
import {
  afterDomainCommit,
  createAlias,
  createDomain,
  createMailbox,
  deleteDomain,
  deleteMailbox,
  requireDomain,
  setCatchAll,
  toAliasDto,
  toDomainDetail,
  toDomainDto,
  toMailboxDto,
  updateMailbox,
} from "./service.ts";
import { serverStatus } from "../status/status.ts";
import { audit, listAudit } from "../activity/audit.ts";
import { failedIps, listAuthEvents } from "../activity/auth-events.ts";
import { listMailLog } from "../activity/mail-log.ts";
import { flushQueue, queueAction, queueSnapshot } from "../activity/postfix-ctl.ts";
import { readLog } from "../activity/log-view.ts";
import { pageParams } from "../activity/paging.ts";
import { buildOverview } from "./overview.ts";
import { spamHistory } from "./spam.ts";
import { listWebSessions, revokeWebSession } from "./sessions.ts";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth, requireAdmin);

/** Reads an optional enum query parameter; anything else is ignored rather than rejected. */
function pick<T extends string>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: string | undefined): T | undefined {
  const r = schema.safeParse(value);
  return r.success ? r.data : undefined;
}

// ---- domains -----------------------------------------------------------------
adminRoutes.get("/domains", async (c) => {
  const domains = await Domain.findAll({ order: [["name", "ASC"]] });
  return c.json(await Promise.all(domains.map(toDomainDto)));
});

adminRoutes.post("/domains", async (c) => {
  const { name } = await parseJson(c, DomainCreateSchema);
  const domain = await createDomain(name);
  await afterDomainCommit(domain);
  await audit(c, "domain.create", domain.name);
  return c.json(await toDomainDto(domain), 201);
});

adminRoutes.get("/domains/:id", async (c) => c.json(await toDomainDetail(await requireDomain(c.req.param("id")))));

adminRoutes.patch("/domains/:id", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  const body = await parseJson(c, DomainUpdateSchema);
  if (body.active !== undefined) {
    domain.active = body.active;
    await domain.save();
    await syncSelectorMap();
  }
  if (body.catchAll !== undefined) await setCatchAll(domain, body.catchAll);
  await audit(c, "domain.update", domain.name, body);
  return c.json(await toDomainDto(domain));
});

adminRoutes.delete("/domains/:id", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  await deleteDomain(domain);
  await audit(c, "domain.delete", domain.name);
  return c.json({ ok: true });
});

adminRoutes.get("/domains/:id/dns", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  return c.json(await cachedDomainDns(domain, c.req.query("refresh") === "1"));
});

// ---- mailboxes ---------------------------------------------------------------
adminRoutes.get("/domains/:id/mailboxes", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  const rows = await MailboxRow.findAll({ where: { domainId: domain.id }, order: [["email", "ASC"]] });
  return c.json(await Promise.all(rows.map((m) => toMailboxDto(m, true))));
});

adminRoutes.post("/domains/:id/mailboxes", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  const body = await parseJson(c, MailboxCreateSchema);
  const m = await createMailbox(domain, body);
  await audit(c, "mailbox.create", m.email, { quotaBytes: body.quotaBytes, isAdmin: body.isAdmin });
  return c.json(await toMailboxDto(m), 201);
});

async function requireMailbox(id: string) {
  const m = await MailboxRow.findByPk(id);
  if (!m) throw notFound("Mailbox not found");
  return m;
}

adminRoutes.patch("/mailboxes/:id", async (c) => {
  const m = await requireMailbox(c.req.param("id"));
  const body = await parseJson(c, MailboxUpdateSchema);
  await updateMailbox(m, body);
  const { password, ...changes } = body;
  await audit(c, "mailbox.update", m.email, password !== undefined ? { ...changes, password: "changed" } : changes);
  return c.json(await toMailboxDto(m));
});

adminRoutes.delete("/mailboxes/:id", async (c) => {
  const m = await requireMailbox(c.req.param("id"));
  await deleteMailbox(m);
  await audit(c, "mailbox.delete", m.email);
  return c.json({ ok: true });
});

// ---- aliases -----------------------------------------------------------------
adminRoutes.get("/domains/:id/aliases", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  const rows = await AliasRow.findAll({ where: { domainId: domain.id }, order: [["source", "ASC"]] });
  return c.json(rows.map(toAliasDto));
});

adminRoutes.post("/domains/:id/aliases", async (c) => {
  const domain = await requireDomain(c.req.param("id"));
  const body = await parseJson(c, AliasCreateSchema);
  const a = await createAlias(domain, body.localPart, body.destination);
  await audit(c, "alias.create", a.source, { destination: a.destination });
  return c.json(toAliasDto(a), 201);
});

adminRoutes.patch("/aliases/:id", async (c) => {
  const a = await AliasRow.findByPk(c.req.param("id"));
  if (!a) throw notFound("Alias not found");
  const body = await parseJson(c, AliasUpdateSchema);
  if (body.destination !== undefined) a.destination = body.destination;
  if (body.active !== undefined) a.active = body.active;
  await a.save();
  await audit(c, "alias.update", a.source, body);
  return c.json(toAliasDto(a));
});

adminRoutes.delete("/aliases/:id", async (c) => {
  const a = await AliasRow.findByPk(c.req.param("id"));
  if (!a) throw notFound("Alias not found");
  await a.destroy();
  await audit(c, "alias.delete", a.source, { destination: a.destination });
  return c.json({ ok: true });
});

// ---- status / overview -------------------------------------------------------
adminRoutes.get("/status", async (c) => c.json(await serverStatus()));

adminRoutes.get("/overview", async (c) => {
  const range = pick(OverviewRangeSchema, c.req.query("range")) ?? "24h";
  return c.json(await buildOverview(range, c.req.query("tz")));
});

// ---- security: sign-ins, lockouts, sessions, audit ----------------------------
adminRoutes.get("/auth-events", async (c) => {
  const result = c.req.query("result");
  return c.json(
    await listAuthEvents({
      ...pageParams((k) => c.req.query(k)),
      result: result === "success" || result === "failed" ? result : undefined,
      source: pick(AuthSourceSchema, c.req.query("source")),
      q: c.req.query("q") || undefined,
    }),
  );
});

adminRoutes.get("/auth-events/failed-ips", async (c) => {
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 24 * 90);
  return c.json(await failedIps(hours, 20));
});

adminRoutes.get("/lockouts", async (c) => c.json(await listLockouts()));
adminRoutes.delete("/lockouts/:key", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  await removeLockout(key);
  await audit(c, "lockout.remove", key);
  return c.json({ ok: true });
});

adminRoutes.get("/sessions", async (c) => c.json(await listWebSessions(c.get("sessionId"))));
adminRoutes.delete("/sessions/:id", async (c) => {
  const email = await revokeWebSession(c.req.param("id"));
  await audit(c, "session.revoke", email);
  return c.json({ ok: true });
});

adminRoutes.get("/audit", async (c) => c.json(await listAudit({ ...pageParams((k) => c.req.query(k)), q: c.req.query("q") || undefined })));

// ---- mail flow: log, queue, spam filter ----------------------------------------
adminRoutes.get("/mail-log", async (c) => {
  const status = c.req.query("status");
  return c.json(
    await listMailLog({
      ...pageParams((k) => c.req.query(k)),
      direction: pick(MailDirectionSchema, c.req.query("direction")),
      status: status === "problems" ? "problems" : pick(MailLogStatusSchema, status),
      q: c.req.query("q") || undefined,
    }),
  );
});

adminRoutes.get("/queue", async (c) => c.json(await queueSnapshot(0)));

adminRoutes.post("/queue/flush", async (c) => {
  await flushQueue();
  await audit(c, "queue.flush", null);
  return c.json({ ok: true });
});

adminRoutes.post("/queue/:queueId/:action", async (c) => {
  const action = pick(QueueActionSchema, c.req.param("action"));
  if (!action) throw badRequest("Unknown queue action");
  const queueId = c.req.param("queueId");
  await queueAction(queueId, action);
  await audit(c, `queue.${action}`, queueId);
  return c.json({ ok: true });
});

adminRoutes.get("/spam-history", async (c) => c.json(await spamHistory()));

// ---- raw logs ------------------------------------------------------------------
adminRoutes.get("/logs", async (c) => {
  const source = pick(LogSourceSchema, c.req.query("source")) ?? "postfix";
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 500, 50), 5000);
  return c.json(
    await readLog(source, {
      q: c.req.query("q") || undefined,
      level: pick(LogLevelSchema, c.req.query("level")),
      limit,
      includeOwn: c.req.query("own") === "1",
    }),
  );
});
