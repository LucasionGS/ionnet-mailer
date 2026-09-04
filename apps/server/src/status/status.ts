import net from "node:net";
import tls from "node:tls";
import type { ServerStatus } from "@ionnet/shared";
import { config } from "../config.ts";
import { AliasRow, Domain, MailboxRow } from "../db/models.ts";
import { sequelize } from "../db/sequelize.ts";
import { redis } from "../redis.ts";
import { getPublicIp } from "../dns/publicip.ts";
import { publicResolver, safe } from "../dns/resolver.ts";

function tcpCheck(host: string, port: number, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function certInfo(): Promise<ServerStatus["certificate"]> {
  return new Promise((resolve) => {
    const s = tls.connect({ host: config.IMAP_HOST, port: 993, servername: config.MAIL_HOSTNAME, rejectUnauthorized: false, timeout: 4000 }, () => {
      const cert = s.getPeerCertificate();
      s.destroy();
      if (!cert || !cert.valid_to) return resolve(null);
      const validTo = new Date(cert.valid_to);
      const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
      const subject = one(cert.subject?.CN);
      const issuer = one(cert.issuer?.CN) || one(cert.issuer?.O);
      resolve({
        subject,
        issuer,
        validFrom: new Date(cert.valid_from).toISOString(),
        validTo: validTo.toISOString(),
        daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000),
        selfSigned: subject === issuer || issuer === "",
      });
    });
    s.once("error", () => resolve(null));
    s.once("timeout", () => {
      s.destroy();
      resolve(null);
    });
  });
}

async function rspamdStats(): Promise<ServerStatus["rspamd"]> {
  try {
    const res = await fetch(`${config.RSPAMD_URL}/stat`, { headers: config.RSPAMD_PASSWORD ? { Password: config.RSPAMD_PASSWORD } : {}, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { scanned?: number; learned?: number; actions?: Record<string, number>; ham_count?: number; spam_count?: number };
    return { scanned: d.scanned ?? 0, spam: d.spam_count ?? 0, ham: d.ham_count ?? 0, learned: d.learned ?? 0 };
  } catch {
    return null;
  }
}

export async function serverStatus(): Promise<ServerStatus> {
  const publicIp = await getPublicIp();
  const ptr = publicIp ? await safe(publicResolver().reverse(publicIp), []) : [];
  const checks: Array<[string, () => Promise<boolean>, string]> = [
    ["Postfix SMTP (25)", () => tcpCheck(config.SMTP_HOST, 25), "inbound mail"],
    ["Postfix submission (587)", () => tcpCheck(config.SMTP_HOST, 587), "authenticated sending"],
    ["Postfix SMTPS (465)", () => tcpCheck(config.SMTP_HOST, 465), "authenticated sending"],
    ["Dovecot IMAPS (993)", () => tcpCheck(config.IMAP_HOST, 993), "IMAP clients"],
    ["Dovecot POP3S (995)", () => tcpCheck(config.IMAP_HOST, 995), "POP3 clients"],
    ["Dovecot internal IMAP (143)", () => tcpCheck(config.IMAP_HOST, config.IMAP_PORT), "web client"],
    ["rspamd", () => tcpCheck(new URL(config.RSPAMD_URL).hostname, Number(new URL(config.RSPAMD_URL).port || 11334)), "spam filter"],
    ["Redis", async () => (await redis().ping()) === "PONG", "rate limiting, spam statistics"],
    ["PostgreSQL", async () => {
      await sequelize.query("SELECT 1");
      return true;
    }, "accounts and settings"],
  ];
  const services = await Promise.all(
    checks.map(async ([name, fn, detail]) => {
      let ok = false;
      try {
        ok = await fn();
      } catch {
        ok = false;
      }
      return { name, ok, detail: ok ? detail : `unreachable (${detail})` };
    }),
  );
  const [certificate, rspamd, domains, mailboxes, aliases] = await Promise.all([certInfo(), rspamdStats(), Domain.count(), MailboxRow.count(), AliasRow.count()]);
  return {
    hostname: config.MAIL_HOSTNAME,
    publicIp,
    ptr,
    version: config.version,
    certificate,
    services,
    rspamd,
    counts: { domains, mailboxes, aliases },
    clamavEnabled: config.CLAMAV_ENABLED,
  };
}
