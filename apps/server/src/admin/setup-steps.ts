/**
 * Setup steps: things a working server should have that the first-run wizard sets up,
 * checked against the live data so instances created before a step existed (or domains
 * added later) show up as incomplete. The wizard and the admin page run the same code.
 */
import type { ReportAddressesApply, SetupStep, SetupStepKey } from "@ionnet/shared";
import { AliasRow, Domain, MailboxRow, getSetting, setSetting } from "../db/models.ts";
import { REPORT_LOCAL_PARTS } from "../dns/records.ts";
import { badRequest } from "../errors.ts";
import { createMailbox, requireDomain, sequelize } from "./service.ts";

type Item = SetupStep["items"][number];

interface StepDef {
  key: SetupStepKey;
  title: string;
  description: string;
  check(): Promise<Item[]>;
}

// ---- skipped steps ---------------------------------------------------------------
const SKIPPED_SETTING = "setup_steps_skipped";

async function skippedSteps(): Promise<Set<string>> {
  try {
    const list: unknown = JSON.parse((await getSetting(SKIPPED_SETTING)) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

export async function setStepSkipped(key: SetupStepKey, skipped: boolean): Promise<void> {
  const set = await skippedSteps();
  if (skipped) set.add(key);
  else set.delete(key);
  await setSetting(SKIPPED_SETTING, JSON.stringify([...set]));
}

// ---- report addresses ------------------------------------------------------------
interface ReportAddress {
  domain: Domain;
  localPart: string;
  address: string;
  /** an active mailbox or alias receives it */
  ok: boolean;
  /** a disabled or send-only mailbox holds the address, so no alias can be added for it */
  disabledMailbox: boolean;
  detail: string;
}

async function reportAddresses(): Promise<ReportAddress[]> {
  const domains = await Domain.findAll({ where: { active: true }, order: [["name", "ASC"]] });
  const wanted = domains.flatMap((domain) => Object.values(REPORT_LOCAL_PARTS).map((localPart) => ({ domain, localPart, address: `${localPart}@${domain.name}` })));
  const emails = wanted.map((w) => w.address);
  const [mailboxes, aliases] = await Promise.all([
    MailboxRow.findAll({ where: { email: emails } }),
    AliasRow.findAll({ where: { source: emails, active: true }, order: [["destination", "ASC"]] }),
  ]);
  return wanted.map((w) => {
    const mailbox = mailboxes.find((m) => m.email === w.address);
    const targets = aliases.filter((a) => a.source === w.address).map((a) => a.destination);
    if (mailbox?.active && mailbox.receiveMail) return { ...w, ok: true, disabledMailbox: false, detail: "Mailbox" };
    if (mailbox?.active) return { ...w, ok: false, disabledMailbox: true, detail: "Send-only mailbox: turn on receiving, or delete it so an alias can take its place" };
    if (mailbox) return { ...w, ok: false, disabledMailbox: true, detail: "Disabled mailbox: enable it, or delete it so an alias can take its place" };
    if (targets.length) return { ...w, ok: true, disabledMailbox: false, detail: `Forwards to ${targets.join(", ")}` };
    return { ...w, ok: false, disabledMailbox: false, detail: "Missing: reports sent here bounce" };
  });
}

/** Whether mail to a local address would be accepted (it is an active, receiving mailbox or an alias). */
async function deliverable(address: string): Promise<boolean> {
  const [mailbox, alias] = await Promise.all([
    MailboxRow.findOne({ where: { email: address, active: true, receiveMail: true } }),
    AliasRow.findOne({ where: { source: address, active: true } }),
  ]);
  return !!(mailbox || alias);
}

/**
 * Makes every missing report address deliver: as an alias to `destination`, or to a new
 * mailbox created for the reports. Returns the addresses it added and where they deliver.
 */
export async function applyReportAddresses(input: ReportAddressesApply): Promise<{ addresses: string[]; destination: string; mailbox: MailboxRow | null }> {
  const missing = (await reportAddresses()).filter((r) => !r.ok);
  const blocked = missing.find((r) => r.disabledMailbox);
  if (blocked) throw badRequest(`${blocked.address} is a mailbox that does not receive mail. Enable it, or delete it so an alias can take its place.`);

  const newMailboxDomain = input.mode === "mailbox" ? await requireDomain(input.domainId) : null;
  const destination = input.mode === "forward" ? input.destination : `${input.localPart}@${newMailboxDomain!.name}`;
  if (input.mode === "forward") {
    if (missing.some((r) => r.address === destination)) throw badRequest(`${destination} is one of the addresses being created; pick a mailbox that already exists.`);
    const local = await Domain.findOne({ where: { name: destination.split("@").pop()! } });
    if (local && !(await deliverable(destination))) throw badRequest(`${destination} does not exist on this server.`);
  }

  return sequelize.transaction(async (transaction) => {
    const mailbox =
      input.mode === "mailbox"
        ? await createMailbox(newMailboxDomain!, { localPart: input.localPart, displayName: input.displayName, password: input.password, quotaBytes: 0, isAdmin: false }, transaction)
        : null;
    const addresses: string[] = [];
    for (const r of missing) {
      if (r.address === destination) continue; // the new mailbox itself
      // An admin may have disabled this alias before; turn it back on instead of adding a duplicate.
      const existing = await AliasRow.findOne({ where: { source: r.address, destination }, transaction });
      if (existing) await existing.update({ active: true }, { transaction });
      else await AliasRow.create({ domainId: r.domain.id, source: r.address, destination }, { transaction });
      addresses.push(r.address);
    }
    return { addresses, destination, mailbox };
  });
}

// ---- registry --------------------------------------------------------------------
const STEPS: StepDef[] = [
  {
    key: "report-addresses",
    title: "DMARC and TLS report addresses",
    description:
      "Each domain's DMARC and TLS-RPT records ask other providers to send reports to its dmarc@ and tlsrpt@ address. Those addresses have to exist, or the reports bounce. They can forward to a mailbox you already have, or to a separate mailbox just for reports.",
    check: async () => (await reportAddresses()).map((r) => ({ label: r.address, done: r.ok, detail: r.detail })),
  },
];

export async function listSetupSteps(): Promise<SetupStep[]> {
  const skipped = await skippedSteps();
  return Promise.all(
    STEPS.map(async (s) => {
      const items = await s.check();
      const state = items.every((i) => i.done) ? "done" : skipped.has(s.key) ? "skipped" : "todo";
      return { key: s.key, title: s.title, description: s.description, state, items };
    }),
  );
}
