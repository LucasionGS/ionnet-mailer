import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { LogLevel, LogSource, LogView } from "@ionnet/shared";
import { config } from "../config.ts";
import { recentAppLog } from "../logger.ts";
import { parseSyslogTime } from "./postfix-parse.ts";

// The viewer shows the end of the current file; older lines are in the rotated files.
const TAIL_BYTES = 4 * 1024 * 1024;

const FILES: Record<Exclude<LogSource, "app">, string> = { postfix: "postfix.log", dovecot: "dovecot.log" };

function tailLines(buf: Buffer, truncated: boolean): string[] {
  const lines = buf.toString("utf8").split("\n");
  if (truncated) lines.shift(); // starts mid-line
  return lines.filter(Boolean);
}

async function readTail(file: string): Promise<string[] | null> {
  let fh;
  try {
    fh = await open(file, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return tailLines(buf, start > 0);
  } finally {
    await fh.close();
  }
}

/** The newest rotated file: Postfix gzips to "postfix.log.<date>.gz", Dovecot's entrypoint keeps "dovecot.log.1". */
async function readPreviousTail(file: string, want: number): Promise<string[]> {
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    const names = (await readdir(dir)).filter((n) => n.startsWith(`${base}.`));
    const withTime = await Promise.all(names.map(async (n) => ({ n, t: (await stat(path.join(dir, n))).mtimeMs })));
    const newest = withTime.sort((a, b) => b.t - a.t)[0];
    if (!newest) return [];
    let buf = await readFile(path.join(dir, newest.n));
    if (newest.n.endsWith(".gz")) buf = gunzipSync(buf);
    const start = Math.max(0, buf.length - want);
    return tailLines(buf.subarray(start), start > 0);
  } catch {
    return [];
  }
}

// "Sep 22 09:22:07 mail postfix/smtpd[1]: ..." (Postfix) or "Sep 22 09:22:07 imap-login: Info: ..." (Dovecot)
const SYSLOG_RE = /^([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d\d:\d\d:\d\d) (.*)$/;

function levelOf(source: LogSource, text: string): LogLevel {
  if (source === "postfix") {
    if (/\b(fatal|panic|error): /.test(text)) return "error";
    if (/\bwarning: /.test(text)) return "warn";
    return "info";
  }
  if (/: (Fatal|Panic|Error): /.test(text)) return "error";
  if (/: Warning: /.test(text)) return "warn";
  return "info";
}

// Lines that carry no information but would bury the rest.
const NOISE = [/postfix-script\[\d+\]: the Postfix mail system is running/];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The web app talks to Dovecot and Postfix constantly: an IMAP session per
 * signed-in user (as the master user) and health checks every 30 seconds.
 * Returns a filter that drops those lines, following Dovecot session ids so
 * the later lines of an app session go too.
 */
function ownTrafficFilter(source: "postfix" | "dovecot"): (text: string) => boolean {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal)
    .map((i) => escapeRe(i!.address));
  if (!ips.length) return () => false;
  const ip = `(?:${ips.join("|")})`;
  if (source === "postfix") {
    const re = new RegExp(`(?:(?:dis)?connect from|lost connection after \\w+ from) [^\\s\\[]*\\[${ip}\\]`);
    return (text) => re.test(text);
  }
  const master = escapeRe(config.DOVECOT_MASTER_USER);
  const opens = new RegExp(`^auth\\(${master},|rip=${ip},`);
  const sessions = new Set<string>();
  return (text) => {
    // Login sessions are 16 base64 characters: "auth(…)<id>", "session=<id>", "imap(user)<pid><id>".
    const sid = /<([A-Za-z0-9+/]{16})>/.exec(text)?.[1];
    if (opens.test(text)) {
      if (sid) sessions.add(sid);
      return true;
    }
    return !!sid && sessions.has(sid);
  };
}

export interface LogQuery {
  q?: string;
  level?: LogLevel;
  limit: number;
  /** keep the web app's own connections and health checks */
  includeOwn?: boolean;
}

export async function readLog(source: LogSource, f: LogQuery): Promise<LogView> {
  const minLevel = f.level === "error" ? 2 : f.level === "warn" ? 1 : 0;
  const rank: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };
  const needle = f.q?.trim().toLowerCase();
  const keep = (level: LogLevel, text: string) => rank[level] >= minLevel && (!needle || text.toLowerCase().includes(needle));

  if (source === "app") {
    const lines = recentAppLog()
      .filter((l) => keep(l.level === "debug" ? "info" : l.level, l.text))
      .slice(-f.limit)
      .map((l) => ({ time: l.time, level: l.level === "debug" ? ("info" as const) : l.level, text: l.text }));
    return { source, available: true, note: "The app keeps its last 2,000 lines in memory. Run `docker compose logs app` for more.", lines };
  }

  const file = path.join(config.LOGS_DIR, FILES[source]);
  let raw = await readTail(file);
  // Just after a rotation the current file is nearly empty; show the end of the previous one too.
  if (raw && raw.length < f.limit) raw = [...(await readPreviousTail(file, TAIL_BYTES)), ...raw];
  if (!raw) {
    return {
      source,
      available: false,
      note: `${file} is not readable. The mail-logs volume must be mounted into the ${source} and app containers.`,
      lines: [],
    };
  }
  const now = new Date();
  const own = f.includeOwn ? null : ownTrafficFilter(source);
  const out: LogView["lines"] = [];
  for (const line of raw) {
    if (NOISE.some((re) => re.test(line))) continue;
    const m = SYSLOG_RE.exec(line);
    const time = m ? parseSyslogTime(m[1]!, m[2]!, m[3]!, now) : null;
    // Postfix lines repeat the short hostname after the time; it adds nothing here.
    const text = m ? (source === "postfix" ? m[4]!.replace(/^\S+ /, "") : m[4]!) : line;
    if (own?.(text)) continue;
    const level = levelOf(source, text);
    if (keep(level, text)) out.push({ time: time?.toISOString() ?? null, level, text });
  }
  return { source, available: true, note: null, lines: out.slice(-f.limit) };
}
