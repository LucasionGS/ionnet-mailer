import type { DnsRecord } from "@ionnet/shared";
import type { Domain } from "../db/models.ts";

export type RecordSpec = Omit<DnsRecord, "status" | "found"> & {
  /** Value used for comparison against DNS answers (defaults to `value`). */
  expect: string;
  /** Comparison mode. */
  match: "exact" | "contains" | "mx" | "srv" | "any";
};

const TTL = 3600;

/** Where the DMARC and TLS-RPT records ask receivers to send reports; the "report-addresses" setup step creates them. */
export const REPORT_LOCAL_PARTS = { dmarc: "dmarc", tlsrpt: "tlsrpt" } as const;

export function splitTxt(value: string, size = 255): string {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += size) parts.push(`"${value.slice(i, i + size)}"`);
  return parts.join(" ");
}

export function mtaStsId(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

export function buildRecordSpecs(domain: Domain, hostname: string, publicIp: string | null): RecordSpec[] {
  const d = domain.name;
  const dkimValue = `v=DKIM1; k=rsa; p=${domain.dkimPublicKeyB64}`;
  const specs: RecordSpec[] = [];

  if (hostname === d || hostname.endsWith(`.${d}`)) {
    specs.push({
      key: "host-a",
      group: "required",
      title: "Mail server address",
      description: `Points ${hostname} at this server so other mail servers can reach it.`,
      type: "A",
      name: hostname,
      value: publicIp ?? "<this server's public IP>",
      ttl: TTL,
      expect: publicIp ?? "",
      match: publicIp ? "exact" : "any",
    });
  }

  specs.push(
    {
      key: "mx",
      group: "required",
      title: "MX record",
      description: "Tells the world that mail for this domain is delivered to this server.",
      type: "MX",
      name: d,
      value: `${hostname}.`,
      priority: 10,
      ttl: TTL,
      expect: hostname,
      match: "mx",
    },
    {
      key: "spf",
      group: "required",
      title: "SPF",
      description: "Authorizes this server (via the MX record) to send mail for the domain.",
      type: "TXT",
      name: d,
      value: "v=spf1 mx -all",
      ttl: TTL,
      expect: "v=spf1 mx -all",
      match: "exact",
    },
    {
      key: "dkim",
      group: "required",
      title: "DKIM public key",
      description: "Lets receivers verify the cryptographic signature added to every outgoing message.",
      type: "TXT",
      name: `${domain.dkimSelector}._domainkey.${d}`,
      value: splitTxt(dkimValue),
      ttl: TTL,
      expect: dkimValue,
      match: "exact",
      hint: "Long TXT values are entered as several quoted strings; most DNS providers accept the single long value as-is.",
    },
    {
      key: "dmarc",
      group: "required",
      title: "DMARC policy",
      description: "Tells receivers what to do with mail that fails SPF/DKIM and where to send reports. Start with p=none, move to p=quarantine once everything passes.",
      type: "TXT",
      name: `_dmarc.${d}`,
      value: `v=DMARC1; p=none; rua=mailto:${REPORT_LOCAL_PARTS.dmarc}@${d}; adkim=s; aspf=s`,
      ttl: TTL,
      expect: "v=DMARC1;",
      match: "contains",
    },
    {
      key: "ptr",
      group: "required",
      title: "Reverse DNS (PTR)",
      description: `Set at your VPS provider, not in your domain's DNS: the server IP must resolve back to ${hostname}.`,
      type: "PTR",
      name: publicIp ?? "<this server's public IP>",
      value: `${hostname}.`,
      expect: hostname,
      match: "exact",
    },
    {
      key: "autoconfig",
      group: "recommended",
      title: "Autoconfig hostname",
      description: "Lets Thunderbird and other clients configure themselves from just the email address.",
      type: "CNAME",
      name: `autoconfig.${d}`,
      value: `${hostname}.`,
      ttl: TTL,
      expect: hostname,
      match: "exact",
    },
    {
      key: "mta-sts-host",
      group: "recommended",
      title: "MTA-STS policy host",
      description: "Serves the MTA-STS policy over HTTPS (handled automatically by this server).",
      type: "CNAME",
      name: `mta-sts.${d}`,
      value: `${hostname}.`,
      ttl: TTL,
      expect: hostname,
      match: "exact",
    },
    {
      key: "mta-sts-txt",
      group: "recommended",
      title: "MTA-STS record",
      description: "Announces that a transport security policy exists. Bump the id whenever the policy changes.",
      type: "TXT",
      name: `_mta-sts.${d}`,
      value: `v=STSv1; id=${mtaStsId()}`,
      ttl: TTL,
      expect: "v=STSv1;",
      match: "contains",
    },
    {
      key: "tlsrpt",
      group: "recommended",
      title: "TLS reporting",
      description: "Receive reports about TLS delivery problems.",
      type: "TXT",
      name: `_smtp._tls.${d}`,
      value: `v=TLSRPTv1; rua=mailto:${REPORT_LOCAL_PARTS.tlsrpt}@${d}`,
      ttl: TTL,
      expect: "v=TLSRPTv1;",
      match: "contains",
    },
  );

  const srv: Array<[string, number]> = [
    ["_imaps._tcp", 993],
    ["_submission._tcp", 587],
    ["_submissions._tcp", 465],
    ["_pop3s._tcp", 995],
  ];
  for (const [svc, port] of srv) {
    specs.push({
      key: `srv-${svc.replace(/^_|\._tcp$/g, "")}`,
      group: "optional",
      title: `Service discovery ${svc}`,
      description: `SRV record advertising ${port} on ${hostname} for client auto-setup.`,
      type: "SRV",
      name: `${svc}.${d}`,
      value: `0 1 ${port} ${hostname}.`,
      priority: 0,
      ttl: TTL,
      expect: `${port} ${hostname}`,
      match: "srv",
    });
  }
  return specs;
}
