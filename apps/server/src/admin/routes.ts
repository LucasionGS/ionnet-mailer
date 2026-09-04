import { Hono } from "hono";
import {
  AliasCreateSchema,
  AliasUpdateSchema,
  DomainCreateSchema,
  DomainUpdateSchema,
  MailboxCreateSchema,
  MailboxUpdateSchema,
} from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { requireAdmin, requireAuth } from "../http/middleware.ts";
import { parseJson } from "../http/validate.ts";
import { AliasRow, Domain, MailboxRow } from "../db/models.ts";
import { notFound } from "../errors.ts";
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

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth, requireAdmin);

// ---- domains -----------------------------------------------------------------
adminRoutes.get("/domains", async (c) => {
  const domains = await Domain.findAll({ order: [["name", "ASC"]] });
  return c.json(await Promise.all(domains.map(toDomainDto)));
});

adminRoutes.post("/domains", async (c) => {
  const { name } = await parseJson(c, DomainCreateSchema);
  const domain = await createDomain(name);
  await afterDomainCommit(domain);
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
  return c.json(await toDomainDto(domain));
});

adminRoutes.delete("/domains/:id", async (c) => {
  await deleteDomain(await requireDomain(c.req.param("id")));
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
  return c.json(await toMailboxDto(await createMailbox(domain, body)), 201);
});

async function requireMailbox(id: string) {
  const m = await MailboxRow.findByPk(id);
  if (!m) throw notFound("Mailbox not found");
  return m;
}

adminRoutes.patch("/mailboxes/:id", async (c) => {
  const m = await requireMailbox(c.req.param("id"));
  const body = await parseJson(c, MailboxUpdateSchema);
  return c.json(await toMailboxDto(await updateMailbox(m, body)));
});

adminRoutes.delete("/mailboxes/:id", async (c) => {
  await deleteMailbox(await requireMailbox(c.req.param("id")));
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
  return c.json(toAliasDto(await createAlias(domain, body.localPart, body.destination)), 201);
});

adminRoutes.patch("/aliases/:id", async (c) => {
  const a = await AliasRow.findByPk(c.req.param("id"));
  if (!a) throw notFound("Alias not found");
  const body = await parseJson(c, AliasUpdateSchema);
  if (body.destination !== undefined) a.destination = body.destination;
  if (body.active !== undefined) a.active = body.active;
  await a.save();
  return c.json(toAliasDto(a));
});

adminRoutes.delete("/aliases/:id", async (c) => {
  const a = await AliasRow.findByPk(c.req.param("id"));
  if (!a) throw notFound("Alias not found");
  await a.destroy();
  return c.json({ ok: true });
});

// ---- status / lockouts --------------------------------------------------------
adminRoutes.get("/status", async (c) => c.json(await serverStatus()));
adminRoutes.get("/lockouts", async (c) => c.json(await listLockouts()));
adminRoutes.delete("/lockouts/:key", async (c) => {
  await removeLockout(decodeURIComponent(c.req.param("key")));
  return c.json({ ok: true });
});
