import { Hono, type Context } from "hono";
import { APP_NAME } from "@ionnet/shared";
import { config } from "../config.ts";
import { Domain } from "../db/models.ts";

export const wellknownRoutes = new Hono();

function hostOf(c: { req: { header(n: string): string | undefined } }): string {
  return (c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "").split(":")[0]!.toLowerCase();
}

async function domainFor(host: string, prefix: string): Promise<Domain | null> {
  if (!host.startsWith(`${prefix}.`)) return null;
  return Domain.findOne({ where: { name: host.slice(prefix.length + 1), active: true } });
}

wellknownRoutes.get("/.well-known/mta-sts.txt", async (c) => {
  const domain = await domainFor(hostOf(c), "mta-sts");
  if (!domain) return c.notFound();
  const body = ["version: STSv1", "mode: testing", `mx: ${config.MAIL_HOSTNAME}`, "max_age: 604800", ""].join("\r\n");
  return c.text(body, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

function autoconfigXml(domainName: string): string {
  const h = config.MAIL_HOSTNAME;
  return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${domainName}">
    <domain>${domainName}</domain>
    <displayName>${APP_NAME} (${domainName})</displayName>
    <displayShortName>${domainName}</displayShortName>
    <incomingServer type="imap">
      <hostname>${h}</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="pop3">
      <hostname>${h}</hostname>
      <port>995</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${h}</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
    <outgoingServer type="smtp">
      <hostname>${h}</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>
`;
}

const autoconfigHandler = async (c: Context) => {
  const host = hostOf(c);
  let domain = await domainFor(host, "autoconfig");
  if (!domain) domain = await Domain.findOne({ where: { name: host, active: true } });
  if (!domain) {
    // Fallback: infer from ?emailaddress=user@domain when served from the mail hostname.
    const addr = c.req.query("emailaddress") ?? "";
    const name = addr.split("@")[1]?.toLowerCase();
    if (name) domain = await Domain.findOne({ where: { name, active: true } });
  }
  if (!domain) return c.notFound();
  return c.body(autoconfigXml(domain.name), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
};
wellknownRoutes.get("/mail/config-v1.1.xml", autoconfigHandler);
wellknownRoutes.get("/.well-known/autoconfig/mail/config-v1.1.xml", autoconfigHandler);

/** Caddy on-demand TLS "ask" endpoint. */
wellknownRoutes.get("/internal/tls-allowed", async (c) => {
  const host = (c.req.query("domain") ?? "").toLowerCase();
  if (!host) return c.text("missing domain", 400);
  if (host === config.MAIL_HOSTNAME) return c.text("ok");
  for (const prefix of ["mta-sts", "autoconfig"]) {
    if (await domainFor(host, prefix)) return c.text("ok");
  }
  return c.text("forbidden", 403);
});
