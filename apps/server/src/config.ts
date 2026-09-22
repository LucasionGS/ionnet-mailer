import { z } from "zod";

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
  version: process.env.npm_package_version ?? "0.1.0",
};
export type Config = typeof config;
