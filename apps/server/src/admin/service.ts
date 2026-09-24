import type { Alias, Domain as DomainDto, DomainDetail, Mailbox, MailboxCreate, MailboxUpdate } from "@ionnet/shared";
import { Op, type Transaction } from "sequelize";
import { sequelize } from "../db/sequelize.ts";
import { AliasRow, Domain, MailboxRow } from "../db/models.ts";
import { hashPassword } from "../auth/password.ts";
import { generateDkimKeyPair, materializeDomainKey, removeDomainKey, syncSelectorMap } from "./dkim.ts";
import { conflict, badRequest, notFound } from "../errors.ts";
import { getMailboxUsage, getMailboxUsages } from "../mail/usage.ts";

export async function toDomainDto(d: Domain): Promise<DomainDto> {
  const [mailboxCount, aliasCount, catchAll] = await Promise.all([
    MailboxRow.count({ where: { domainId: d.id } }),
    AliasRow.count({ where: { domainId: d.id, source: { [Op.notLike]: "@%" } } }),
    AliasRow.findOne({ where: { domainId: d.id, source: `@${d.name}` } }),
  ]);
  return {
    id: d.id,
    name: d.name,
    active: d.active,
    dkimSelector: d.dkimSelector,
    dkimPublicKey: d.dkimPublicKeyB64,
    catchAll: catchAll?.destination ?? null,
    mailboxCount,
    aliasCount,
    createdAt: d.createdAt.toISOString(),
  };
}

function mailboxDto(m: MailboxRow, usedBytes: number | null): Mailbox {
  return {
    id: m.id,
    domainId: m.domainId,
    localPart: m.localPart,
    email: m.email,
    displayName: m.displayName,
    quotaBytes: Number(m.quotaBytes),
    usedBytes,
    isAdmin: m.isAdmin,
    active: m.active,
    receiveMail: m.receiveMail,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function toMailboxDto(m: MailboxRow, withUsage = false): Promise<Mailbox> {
  return mailboxDto(m, withUsage ? await getMailboxUsage(m).catch(() => null) : null);
}

/** Several mailboxes with their storage use, looked up together. */
export async function toMailboxDtos(rows: MailboxRow[]): Promise<Mailbox[]> {
  const usage = await getMailboxUsages(rows).catch(() => new Map<string, number | null>());
  return rows.map((m) => mailboxDto(m, usage.get(m.id) ?? null));
}

export function toAliasDto(a: AliasRow): Alias {
  return {
    id: a.id,
    domainId: a.domainId,
    source: a.source,
    destination: a.destination,
    active: a.active,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function toDomainDetail(d: Domain): Promise<DomainDetail> {
  const [base, mailboxes, aliases] = await Promise.all([
    toDomainDto(d),
    MailboxRow.findAll({ where: { domainId: d.id }, order: [["email", "ASC"]] }),
    AliasRow.findAll({ where: { domainId: d.id }, order: [["source", "ASC"]] }),
  ]);
  return {
    ...base,
    mailboxes: await toMailboxDtos(mailboxes),
    aliases: aliases.map(toAliasDto),
  };
}

export async function createDomain(name: string, tx?: Transaction): Promise<Domain> {
  if (await Domain.findOne({ where: { name }, transaction: tx })) throw conflict(`Domain ${name} already exists`);
  const keys = generateDkimKeyPair();
  const domain = await Domain.create(
    { name, dkimPrivateKeyPem: keys.privateKeyPem, dkimPublicKeyB64: keys.publicKeyB64 },
    { transaction: tx },
  );
  return domain;
}

export async function afterDomainCommit(domain: Domain): Promise<void> {
  await materializeDomainKey(domain);
  await syncSelectorMap();
}

export async function deleteDomain(domain: Domain): Promise<void> {
  const admins = await MailboxRow.count({ where: { isAdmin: true, active: true } });
  const adminsHere = await MailboxRow.count({ where: { isAdmin: true, active: true, domainId: domain.id } });
  if (adminsHere > 0 && admins - adminsHere <= 0) throw badRequest("This domain holds the only administrator account; create another admin first.");
  await domain.destroy();
  await removeDomainKey(domain);
}

/** Postfix skips send-only mailboxes as alias targets, so pointing an alias at one would lose the mail. */
export async function assertReceivingDestination(destination: string): Promise<void> {
  if (await MailboxRow.findOne({ where: { email: destination, receiveMail: false } })) {
    throw badRequest(`${destination} is a send-only mailbox and does not receive mail`);
  }
}

export async function setCatchAll(domain: Domain, destination: string | null): Promise<void> {
  const source = `@${domain.name}`;
  if (destination) await assertReceivingDestination(destination);
  await AliasRow.destroy({ where: { domainId: domain.id, source } });
  if (destination) await AliasRow.create({ domainId: domain.id, source, destination });
}

export async function createMailbox(
  domain: Domain,
  input: Omit<MailboxCreate, "receiveMail"> & { receiveMail?: boolean },
  tx?: Transaction,
): Promise<MailboxRow> {
  const email = `${input.localPart}@${domain.name}`;
  if (await MailboxRow.findOne({ where: { email }, transaction: tx })) throw conflict(`${email} already exists`);
  if (await AliasRow.findOne({ where: { source: email }, transaction: tx })) throw conflict(`${email} is already used by an alias`);
  return MailboxRow.create(
    {
      domainId: domain.id,
      localPart: input.localPart,
      email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      quotaBytes: input.quotaBytes,
      isAdmin: input.isAdmin,
      receiveMail: input.receiveMail ?? true,
    },
    { transaction: tx },
  );
}

async function assertNotLastAdmin(m: MailboxRow, message: string) {
  if (!m.isAdmin || !m.active) return;
  const others = await MailboxRow.count({ where: { isAdmin: true, active: true, id: { [Op.ne]: m.id } } });
  if (others === 0) throw badRequest(message);
}

export async function updateMailbox(m: MailboxRow, input: MailboxUpdate): Promise<MailboxRow> {
  if (input.isAdmin === false || input.active === false) {
    await assertNotLastAdmin(m, "Cannot remove the last administrator.");
  }
  if (input.displayName !== undefined) m.displayName = input.displayName;
  if (input.password !== undefined) m.passwordHash = await hashPassword(input.password);
  if (input.quotaBytes !== undefined) m.quotaBytes = input.quotaBytes;
  if (input.isAdmin !== undefined) m.isAdmin = input.isAdmin;
  if (input.active !== undefined) m.active = input.active;
  if (input.receiveMail !== undefined) m.receiveMail = input.receiveMail;
  await m.save();
  return m;
}

export async function deleteMailbox(m: MailboxRow): Promise<void> {
  await assertNotLastAdmin(m, "Cannot delete the last administrator.");
  await m.destroy();
}

export async function createAlias(domain: Domain, localPart: string, destination: string): Promise<AliasRow> {
  const source = localPart ? `${localPart}@${domain.name}` : `@${domain.name}`;
  if (localPart && (await MailboxRow.findOne({ where: { email: source } }))) throw conflict(`${source} is a mailbox`);
  if (source === destination) throw badRequest("An alias cannot point at itself");
  if (await AliasRow.findOne({ where: { source, destination } })) throw conflict("This alias already exists");
  await assertReceivingDestination(destination);
  return AliasRow.create({ domainId: domain.id, source, destination });
}

export async function requireDomain(id: string): Promise<Domain> {
  const d = await Domain.findByPk(id);
  if (!d) throw notFound("Domain not found");
  return d;
}

export { sequelize };
