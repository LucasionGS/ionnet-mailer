import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { APP_NAME } from "@ionnet/shared";
import { config } from "../config.ts";
import type { MailboxRow } from "../db/models.ts";
import { logger } from "../logger.ts";
import { HttpError } from "../errors.ts";

const log = logger("imap");
const IDLE_EVICT_MS = 10 * 60_000;

type User = Pick<MailboxRow, "id" | "email">;

/**
 * Builds the connection options for one mailbox. The app never knows user
 * passwords: it authenticates as the Dovecot master user and asks to be
 * authorized as the target user (SASL PLAIN authzid), which Dovecot maps to
 * the `passdb master` block.
 */
export function imapOptions(user: User, clientIp?: string): ImapFlowOptions {
  return {
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    secure: false,
    // Dovecot sits on the private compose network; we deliberately skip STARTTLS there.
    tls: { rejectUnauthorized: false },
    auth: {
      user: config.DOVECOT_MASTER_USER,
      pass: config.DOVECOT_MASTER_PASSWORD,
      authzid: user.email,
      loginMethod: "AUTH=PLAIN",
    },
    clientInfo: {
      name: APP_NAME,
      version: config.version,
      ...(clientIp && clientIp !== "unknown" ? { "x-originating-ip": clientIp } : {}),
    },
    logger: false,
    disableAutoIdle: true,
  };
}

class PooledConnection {
  user: User;
  client: ImapFlow | null = null;
  lastUsed = Date.now();
  busy: Promise<unknown> = Promise.resolve();
  connecting: Promise<ImapFlow> | null = null;
  clientIp: string | undefined;

  constructor(user: User, clientIp?: string) {
    this.user = user;
    this.clientIp = clientIp;
  }

  async connection(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new ImapFlow(imapOptions(this.user, this.clientIp));
      client.on("error", (err) => log.warn(`connection error for ${this.user.email}: ${err.message}`));
      client.on("close", () => {
        if (this.client === client) this.client = null;
      });
      await client.connect();
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** ImapFlow is not safe for interleaved commands, so every caller queues behind the previous one. */
  run<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const next = this.busy.then(async () => {
      this.lastUsed = Date.now();
      const client = await this.connection();
      try {
        return await fn(client);
      } finally {
        this.lastUsed = Date.now();
      }
    });
    this.busy = next.catch(() => undefined);
    return next;
  }

  async close() {
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.logout();
      } catch {
        c.close();
      }
    }
  }
}

class ConnectionPool {
  private conns = new Map<string, PooledConnection>();
  private sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref();
  }

  withClient<T>(user: User, fn: (client: ImapFlow) => Promise<T>, clientIp?: string): Promise<T> {
    let conn = this.conns.get(user.id);
    if (!conn) {
      conn = new PooledConnection(user, clientIp);
      this.conns.set(user.id, conn);
    }
    return conn.run(fn).catch((err: unknown) => {
      throw translateImapError(err);
    });
  }

  async evict(userId: string) {
    const conn = this.conns.get(userId);
    if (conn) {
      this.conns.delete(userId);
      await conn.close();
    }
  }

  private async sweep() {
    const now = Date.now();
    for (const [id, conn] of this.conns) {
      if (now - conn.lastUsed > IDLE_EVICT_MS) {
        this.conns.delete(id);
        await conn.close();
      }
    }
  }

  async closeAll() {
    clearInterval(this.sweeper);
    await Promise.all([...this.conns.values()].map((c) => c.close()));
    this.conns.clear();
  }
}

export const pool = new ConnectionPool();

function translateImapError(err: unknown): unknown {
  if (err instanceof HttpError) return err;
  const e = err as { responseText?: string; code?: string; message?: string; authenticationFailed?: boolean };
  if (e?.authenticationFailed) return new HttpError(502, "imap_auth", "Mail store rejected the application login. Check DOVECOT_MASTER_PASSWORD.");
  if (e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND") return new HttpError(503, "imap_unavailable", "Mail store is not reachable right now.");
  if (e?.responseText?.includes("[NONEXISTENT]") || /Mailbox doesn't exist/i.test(e?.responseText ?? "")) {
    return new HttpError(404, "folder_not_found", "Folder does not exist");
  }
  return err;
}

/** Opens a standalone connection (used for IDLE subscribers and one-off tasks). */
export async function openDedicated(user: User, clientIp?: string): Promise<ImapFlow> {
  const client = new ImapFlow({ ...imapOptions(user, clientIp), disableAutoIdle: false });
  client.on("error", (err) => log.debug(`dedicated connection error for ${user.email}: ${err.message}`));
  await client.connect();
  return client;
}
