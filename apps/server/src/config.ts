import { readFileSync } from "node:fs";
import { z } from "zod";

/** The server's package.json sits one level above both src/ (dev) and dist/ (production, started without npm). */
function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  MAIL_HOSTNAME: z.string().min(1),
  PUBLIC_URL: z.string().url().optional(),
  APP_SECRET: z.string().min(8),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  IMAP_HOST: z.string().default("dovecot"),
  IMAP_PORT: z.coerce.number().int().default(143),
  SMTP_HOST: z.string().default("postfix"),
  SMTP_PORT: z.coerce.number().int().default(10025),
  DOVECOT_MASTER_USER: z.string().default("ionnet"),
  DOVECOT_MASTER_PASSWORD: z.string().min(1),
  // Dovecot's doveadm HTTP API (quota usage and recalculation); internal network only.
  DOVEADM_URL: z.string().default("http://dovecot:8080"),
  RSPAMD_URL: z.string().default("http://rspamd:11334"),
  RSPAMD_PASSWORD: z.string().optional(),
  DKIM_DIR: z.string().default("/dkim"),
  DKIM_GID: z.coerce.number().int().optional(),
  TRUST_PROXY: bool,
  DEV_SEED: bool,
  CLAMAV_ENABLED: bool,
  // Shared volume where Postfix and Dovecot write their logs (read-only here).
  LOGS_DIR: z.string().default("/logs"),
  // Shared volume the Postfix container polls for queue commands (see docker/postfix/postfix-ctl.sh).
  POSTFIX_CTL_DIR: z.string().default("/postfix-ctl"),
  // Second listener for Dovecot's event exporter; only reachable inside the compose network.
  INTERNAL_PORT: z.coerce.number().int().default(3001),
  // Sign-in attempts, mail log and audit entries older than this are deleted.
  ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  // The compose network; its addresses (the app, Caddy, Docker's port proxy) are never banned.
  MAIL_NETWORK_SUBNET: z.string().default("172.28.0.0/24"),
  // Automatic IP bans for password guessing (web, IMAP, POP3, SMTP AUTH, ManageSieve). See auth/bans.ts.
  AUTOBAN_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
  AUTOBAN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(60),
  AUTOBAN_DISTINCT_ACCOUNTS: z.coerce.number().int().min(2).default(3),
  AUTOBAN_FAILURES: z.coerce.number().int().min(3).default(20),
  AUTOBAN_DURATION_HOURS: z.coerce.number().min(0.1).default(24),
  // Slow, distributed guessing: failures for accounts that don't exist, counted over a longer window (0 = off).
  AUTOBAN_SLOW_WINDOW_HOURS: z.coerce.number().int().min(1).default(24),
  AUTOBAN_UNKNOWN_FAILURES: z.coerce.number().int().min(0).default(3),
  // This many addresses in one /24 (IPv6: /64) trying accounts that don't exist bans the whole network (0 = off).
  AUTOBAN_NETWORK_ADDRESSES: z.coerce.number().int().min(0).default(5),
  // Comma-separated addresses/networks that are never banned automatically (the compose network always is).
  AUTOBAN_ALLOWLIST: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV !== "production",
  publicUrl: parsed.data.PUBLIC_URL ?? `https://${parsed.data.MAIL_HOSTNAME}`,
  version: process.env.npm_package_version ?? packageVersion(),
};
export type Config = typeof config;
