type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

export interface AppLogLine {
  time: string;
  level: Level;
  text: string;
}

// The most recent lines, for the admin log viewer (the full log is `docker compose logs app`).
const RING_SIZE = 2000;
const ring: AppLogLine[] = [];

export function recentAppLog(): readonly AppLogLine[] {
  return ring;
}

function summarize(extra: unknown): string {
  if (extra instanceof Error) return extra.message;
  if (typeof extra === "string") return extra;
  try {
    return JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}

function write(level: Level, scope: string, msg: string, extra?: unknown) {
  if (order[level] < min) return;
  const time = new Date().toISOString();
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(line, extra instanceof Error ? (extra.stack ?? extra.message) : extra);
  else fn(line);
  ring.push({ time, level, text: `[${scope}] ${msg}${extra !== undefined ? ` ${summarize(extra)}` : ""}` });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => write("error", scope, msg, extra),
  };
}
