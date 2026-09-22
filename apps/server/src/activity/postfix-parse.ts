/**
 * Parses Postfix's mail log (maillog_file, syslog format) into the events the
 * mail log needs. Pure functions only, so they are easy to test against real lines.
 */

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * Syslog timestamps ("Sep 22 09:22:07") have no year or zone. They are local time
 * in the container's TZ, which compose sets to the same value for every service.
 */
export function parseSyslogTime(month: string, day: string, time: string, now = new Date()): Date | null {
  const m = MONTHS[month];
  const [h, mi, s] = time.split(":").map(Number);
  if (m === undefined || h === undefined || mi === undefined || s === undefined) return null;
  const d = new Date(now.getFullYear(), m, Number(day), h, mi, s);
  // A December line read in January belongs to last year.
  if (d.getTime() - now.getTime() > 2 * 86_400_000) d.setFullYear(d.getFullYear() - 1);
  return d;
}

export interface PostfixLine {
  time: Date;
  /** "smtpd", "cleanup", "qmgr", "lmtp", "smtp", ... */
  service: string;
  /** syslog_name without the service, e.g. "postfix/submission" */
  syslogName: string;
  message: string;
}

const LINE_RE = /^([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d\d:\d\d:\d\d) \S+ (postfix[\w./-]*)\[\d+\]: (.*)$/;

export function parseLine(line: string, now = new Date()): PostfixLine | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const time = parseSyslogTime(m[1]!, m[2]!, m[3]!, now);
  if (!time) return null;
  const program = m[4]!;
  const cut = program.lastIndexOf("/");
  return { time, service: program.slice(cut + 1), syslogName: cut > 0 ? program.slice(0, cut) : program, message: m[5]! };
}

/** Which listener accepted the message, from the syslog_name set per service in master.cf. */
export function sourceOf(syslogName: string): string {
  switch (syslogName) {
    case "postfix/smtp-in":
      return "smtp";
    case "postfix/submission":
      return "submission";
    case "postfix/smtps":
      return "smtps";
    case "postfix/app":
      return "app";
    default:
      return "local";
  }
}

export type PostfixEvent =
  | { kind: "client"; qid: string; clientHost: string; clientIp: string; saslUser: string | null }
  | { kind: "pickup"; qid: string; sender: string }
  | { kind: "message-id"; qid: string; messageId: string }
  | { kind: "subject"; qid: string; subject: string }
  | { kind: "queued"; qid: string; sender: string; size: number; nrcpt: number }
  | { kind: "delivery"; qid: string; transport: string; to: string; origTo: string | null; relay: string; dsn: string; status: string; detail: string | null }
  | { kind: "expired"; qid: string }
  | { kind: "removed"; qid: string }
  | { kind: "deleted"; qid: string }
  | {
      kind: "reject";
      qid: string | null;
      stage: string;
      clientHost: string;
      clientIp: string;
      dsn: string | null;
      detail: string;
      from: string;
      to: string | null;
    };

// Short queue ids are upper-case hex; long ones (enable_long_queue_ids) mix digits and letters.
const QID_RE = /^([0-9A-F]{6,12}|(?=[0-9A-Za-z]*\d)(?=[0-9A-Za-z]*[A-Za-z])[0-9A-Za-z]{12,20}): (.*)$/;
const DELIVERY_RE =
  /^to=<([^>]*)>, (?:orig_to=<([^>]*)>, )?relay=([^,]+), (?:conn_use=\d+, )?delay=[\d.]+, delays=[^,]+, dsn=(\d\.\d{1,3}\.\d{1,3}), status=(\w+)(?: \((.*)\))?$/;
const REJECT_RE = /^(?:milter-)?reject: ([\w-]+) from ([^[]*)\[([^\]]*)\](?::\d+)?: (.*?); from=<([^>]*)>(?: to=<([^>]*)>)?/;
const DELIVERY_AGENTS = new Set(["lmtp", "smtp", "error", "retry", "virtual", "local", "discard", "pipe"]);

/** The reply text of a reject: "550 5.1.1 <x@y>: Recipient address rejected: ..." -> dsn + rest. */
function splitReply(text: string): { dsn: string | null; detail: string } {
  const m = /^(?:\d{3} )?(\d\.\d{1,3}\.\d{1,3}) (.*)$/.exec(text);
  return m ? { dsn: m[1]!, detail: m[2]! } : { dsn: null, detail: text };
}

export function parseEvent(l: PostfixLine): PostfixEvent | null {
  const { service, message } = l;

  if (message.startsWith("NOQUEUE: ")) {
    const r = REJECT_RE.exec(message.slice("NOQUEUE: ".length));
    if (!r) return null;
    return { kind: "reject", qid: null, stage: r[1]!, clientHost: r[2]!, clientIp: r[3]!, ...splitReply(r[4]!), from: r[5]!, to: r[6] ?? null };
  }

  const q = QID_RE.exec(message);
  if (!q) return null;
  const qid = q[1]!;
  const rest = q[2]!;

  if (rest.startsWith("reject: ") || rest.startsWith("milter-reject: ")) {
    const r = REJECT_RE.exec(rest);
    if (!r) return null;
    return { kind: "reject", qid, stage: r[1]!, clientHost: r[2]!, clientIp: r[3]!, ...splitReply(r[4]!), from: r[5]!, to: r[6] ?? null };
  }

  switch (service) {
    case "smtpd": {
      const m = /^client=([^[,]*)\[([^\]]*)\](?::\d+)?(?:, sasl_method=[^,]*, sasl_username=([^,]*))?/.exec(rest);
      return m ? { kind: "client", qid, clientHost: m[1]!, clientIp: m[2]!, saslUser: m[3] || null } : null;
    }
    case "pickup": {
      const m = /^uid=\d+ from=<([^>]*)>/.exec(rest);
      return m ? { kind: "pickup", qid, sender: m[1]! } : null;
    }
    case "cleanup": {
      const id = /^message-id=<?([^>]*)>?$/.exec(rest);
      if (id) return { kind: "message-id", qid, messageId: id[1]! };
      // Logged by the "/^Subject:/ INFO" header_checks rule.
      const s = /^info: header Subject: (.*) from (?:[^[\s]*\[[^\]]*\](?::\d+)?|local); from=<[^>]*>/.exec(rest);
      return s ? { kind: "subject", qid, subject: s[1]! } : null;
    }
    case "postsuper":
      // An admin deleted it (postsuper -d), e.g. from the queue page.
      return rest === "removed" ? { kind: "deleted", qid } : null;
    case "qmgr": {
      if (rest === "removed") return { kind: "removed", qid };
      const f = /^from=<([^>]*)>, size=(\d+), nrcpt=(\d+)/.exec(rest);
      if (f) return { kind: "queued", qid, sender: f[1]!, size: Number(f[2]), nrcpt: Number(f[3]) };
      if (/^from=<[^>]*>, status=expired/.test(rest)) return { kind: "expired", qid };
      return null;
    }
  }

  if (DELIVERY_AGENTS.has(service)) {
    const d = DELIVERY_RE.exec(rest);
    if (!d) return null;
    return {
      kind: "delivery",
      qid,
      transport: service,
      to: d[1]!,
      origTo: d[2] ?? null,
      relay: d[3]!,
      dsn: d[4]!,
      status: d[5]!,
      detail: d[6] ?? null,
    };
  }
  return null;
}
