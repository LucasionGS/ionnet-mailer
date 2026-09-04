import { Hono } from "hono";
import { Op } from "sequelize";
import { ContactCreateSchema, ContactUpdateSchema, type AddressSuggestion, type Contact } from "@ionnet/shared";
import type { AppEnv } from "../http/types.ts";
import { requireAuth } from "../http/middleware.ts";
import { parseJson } from "../http/validate.ts";
import { ContactRow, MailboxRow, RecentAddress } from "../db/models.ts";
import { notFound } from "../errors.ts";

export const contactRoutes = new Hono<AppEnv>();
contactRoutes.use("*", requireAuth);

const toDto = (c: ContactRow): Contact => ({
  id: c.id,
  name: c.name,
  emails: c.emails,
  notes: c.notes,
  source: c.source,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

contactRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const where: Record<string | symbol, unknown> = { mailboxId: c.get("user").id };
  if (q) {
    where[Op.or as unknown as string] = [
      { name: { [Op.iLike]: `%${q}%` } },
      { emails: { [Op.overlap]: [q] } },
      { notes: { [Op.iLike]: `%${q}%` } },
    ];
  }
  const rows = await ContactRow.findAll({ where, order: [["name", "ASC"]], limit: 500 });
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.emails.some((e) => e.includes(q)) || r.notes.toLowerCase().includes(q)) : rows;
  return c.json(filtered.map(toDto));
});

contactRoutes.get("/suggest", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const user = c.get("user");
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  const push = (s: AddressSuggestion) => {
    const k = s.address.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  };
  const matches = (name: string, address: string) => !q || name.toLowerCase().includes(q) || address.toLowerCase().includes(q);

  const recents = await RecentAddress.findAll({ where: { mailboxId: user.id }, order: [["uses", "DESC"], ["lastUsedAt", "DESC"]], limit: 200 });
  for (const r of recents) if (matches(r.name, r.address)) push({ name: r.name, address: r.address, source: "recent" });
  const contacts = await ContactRow.findAll({ where: { mailboxId: user.id }, limit: 500 });
  for (const ct of contacts) for (const e of ct.emails) if (matches(ct.name, e)) push({ name: ct.name, address: e, source: "contact" });
  const colleagues = await MailboxRow.findAll({ where: { domainId: user.domainId, active: true, id: { [Op.ne]: user.id } }, limit: 200 });
  for (const m of colleagues) if (matches(m.displayName, m.email)) push({ name: m.displayName, address: m.email, source: "mailbox" });
  return c.json(out.slice(0, 15));
});

contactRoutes.post("/", async (c) => {
  const body = await parseJson(c, ContactCreateSchema);
  const row = await ContactRow.create({ mailboxId: c.get("user").id, name: body.name, emails: body.emails, notes: body.notes, source: "manual" });
  return c.json(toDto(row), 201);
});

async function own(c: { get(k: "user"): MailboxRow }, id: string) {
  const row = await ContactRow.findOne({ where: { id, mailboxId: c.get("user").id } });
  if (!row) throw notFound("Contact not found");
  return row;
}

contactRoutes.patch("/:id", async (c) => {
  const row = await own(c, c.req.param("id"));
  const body = await parseJson(c, ContactUpdateSchema);
  if (body.name !== undefined) row.name = body.name;
  if (body.emails !== undefined) row.emails = body.emails;
  if (body.notes !== undefined) row.notes = body.notes;
  row.source = "manual";
  row.updatedAt = new Date();
  await row.save();
  return c.json(toDto(row));
});

contactRoutes.delete("/:id", async (c) => {
  await (await own(c, c.req.param("id"))).destroy();
  return c.json({ ok: true });
});
