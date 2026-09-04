import type { DnsCheckResult, DnsRecord, SetupHostnameCheckResult } from "@ionnet/shared";
import { config } from "../config.ts";
import { DnsCheckRow, type Domain } from "../db/models.ts";
import { getPublicIp } from "./publicip.ts";
import { buildRecordSpecs, type RecordSpec } from "./records.ts";
import { publicResolver, safe, txt } from "./resolver.ts";

const CACHE_MS = 10 * 60_000;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");

async function lookup(spec: RecordSpec, publicIp: string | null): Promise<string[]> {
  const r = publicResolver();
  switch (spec.type) {
    case "A":
      return safe(r.resolve4(spec.name), []);
    case "AAAA":
      return safe(r.resolve6(spec.name), []);
    case "MX":
      return (await safe(r.resolveMx(spec.name), [])).map((m) => `${m.priority} ${m.exchange}`);
    case "TXT":
      return txt(r, spec.name);
    case "SRV":
      return (await safe(r.resolveSrv(spec.name), [])).map((s) => `${s.priority} ${s.weight} ${s.port} ${s.name}`);
    case "CNAME": {
      const cname = await safe(r.resolveCname(spec.name), []);
      if (cname.length) return cname;
      // An A record pointing at the same IP is just as good as a CNAME.
      const a = await safe(r.resolve4(spec.name), []);
      return a.map((ip) => (publicIp && ip === publicIp ? spec.expect : ip));
    }
    case "PTR":
      return publicIp ? safe(r.reverse(publicIp), []) : [];
  }
}

function evaluate(spec: RecordSpec, found: string[]): DnsRecord["status"] {
  if (spec.match === "any") return found.length ? "ok" : "missing";
  if (!found.length) return "missing";
  const want = norm(spec.expect);
  const hits = found.map(norm);
  switch (spec.match) {
    case "exact":
      return hits.some((h) => h === want) ? "ok" : "mismatch";
    case "contains":
      return hits.some((h) => h.startsWith(want) || h.includes(want)) ? "ok" : "mismatch";
    case "mx":
      return hits.some((h) => h.split(" ").pop() === want) ? "ok" : "mismatch";
    case "srv":
      return hits.some((h) => h.endsWith(want)) ? "ok" : "mismatch";
  }
}

export async function checkDomainDns(domain: Domain): Promise<DnsCheckResult> {
  const publicIp = await getPublicIp();
  const specs = buildRecordSpecs(domain, config.MAIL_HOSTNAME, publicIp);
  const records: DnsRecord[] = await Promise.all(
    specs.map(async (spec) => {
      const found = await lookup(spec, publicIp);
      const { expect: _e, match: _m, ...rest } = spec;
      return { ...rest, found, status: evaluate(spec, found) };
    }),
  );
  return {
    domain: domain.name,
    hostname: config.MAIL_HOSTNAME,
    checkedAt: new Date().toISOString(),
    allRequiredOk: records.filter((r) => r.group === "required").every((r) => r.status === "ok"),
    records,
  };
}

export async function cachedDomainDns(domain: Domain, refresh = false): Promise<DnsCheckResult> {
  if (!refresh) {
    const row = await DnsCheckRow.findByPk(domain.id);
    if (row && Date.now() - row.checkedAt.getTime() < CACHE_MS) return row.result as DnsCheckResult;
  }
  const result = await checkDomainDns(domain);
  await DnsCheckRow.upsert({ domainId: domain.id, result, checkedAt: new Date() });
  return result;
}

export async function checkHostname(hostname: string): Promise<SetupHostnameCheckResult> {
  const r = publicResolver();
  const publicIp = await getPublicIp(true);
  const [a4, a6] = await Promise.all([safe(r.resolve4(hostname), []), safe(r.resolve6(hostname), [])]);
  const aRecords = [...a4, ...a6];
  const ptr = publicIp ? await safe(r.reverse(publicIp), []) : [];
  const warnings: string[] = [];
  if (!publicIp) warnings.push("Could not determine this server's public IP address (no outbound internet access?).");
  if (!aRecords.length) warnings.push(`No A/AAAA record found for ${hostname}. Create one pointing at this server.`);
  const aMatches = !!publicIp && a4.includes(publicIp);
  if (aRecords.length && !aMatches) warnings.push(`${hostname} resolves to ${aRecords.join(", ")}, which is not this server (${publicIp ?? "unknown"}).`);
  const ptrMatches = ptr.map(norm).includes(norm(hostname));
  if (publicIp && !ptrMatches)
    warnings.push(`Reverse DNS for ${publicIp} is ${ptr.length ? ptr.join(", ") : "not set"}; set it to ${hostname} at your hosting provider or most providers will reject your mail.`);
  if (a6.length) warnings.push("An AAAA record exists. Outbound mail uses IPv4 only; remove the AAAA record or configure an IPv6 PTR as well.");
  return { hostname, publicIp, aRecords, aMatches, ptr, ptrMatches, warnings };
}
