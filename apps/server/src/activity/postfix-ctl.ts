import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QueueAction, QueueMessage, QueueSnapshot } from "@ionnet/shared";
import { config } from "../config.ts";
import { HttpError, badRequest } from "../errors.ts";

/**
 * Talks to docker/postfix/postfix-ctl.sh through the shared postfix-ctl volume:
 * we drop "<id>.req" holding one command, the Postfix container runs it and
 * answers with "<id>.res". It needs no network port and no Docker socket.
 */
const TIMEOUT_MS = 10_000;
const POLL_MS = 100;

type Command = "queue" | "flush" | QueueAction;

const QUEUE_ID_RE = /^[0-9A-Za-z]{6,20}$/;

async function run(command: Command, queueId?: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const dir = config.POSTFIX_CTL_DIR;
  try {
    await stat(dir);
  } catch {
    throw new HttpError(503, "unavailable", "The Postfix control channel is not set up: the postfix-ctl volume is missing from the app container.");
  }
  if (queueId !== undefined && (!QUEUE_ID_RE.test(queueId) || queueId === "ALL")) throw badRequest("Invalid queue id");

  const id = randomUUID();
  const tmp = path.join(dir, `${id}.tmp`);
  const req = path.join(dir, `${id}.req`);
  const res = path.join(dir, `${id}.res`);
  await writeFile(tmp, queueId ? `${command} ${queueId}\n` : `${command}\n`, { mode: 0o600 });
  await rename(tmp, req);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    let body: string;
    try {
      body = await readFile(res, "utf8");
    } catch {
      continue;
    }
    await unlink(res).catch(() => undefined);
    const nl = body.indexOf("\n");
    const status = nl === -1 ? body : body.slice(0, nl);
    const output = nl === -1 ? "" : body.slice(nl + 1);
    if (status.trim() !== "ok") throw badRequest(output.trim() || status.replace(/^error:?\s*/, "") || "Postfix refused the command");
    return output;
  }
  await unlink(req).catch(() => undefined);
  throw new HttpError(504, "timeout", "Postfix did not answer. Is the postfix container running?");
}

interface PostqueueJson {
  queue_name?: string;
  queue_id?: string;
  arrival_time?: number;
  message_size?: number;
  sender?: string;
  recipients?: Array<{ address?: string; delay_reason?: string }>;
}

function toQueueMessage(j: PostqueueJson): QueueMessage | null {
  if (!j.queue_id) return null;
  return {
    queueId: j.queue_id,
    queue: j.queue_name ?? "unknown",
    arrivalTime: new Date((j.arrival_time ?? 0) * 1000).toISOString(),
    size: j.message_size ?? 0,
    sender: j.sender ?? "",
    recipients: (j.recipients ?? []).map((r) => ({ address: r.address ?? "", reason: r.delay_reason ?? null })),
  };
}

let cached: { at: number; snapshot: QueueSnapshot } | null = null;
// A failure (e.g. an old Postfix image without the control script) is remembered this long,
// so the overview doesn't wait for a timeout on every refresh.
const FAILURE_TTL_MS = 60_000;

/**
 * `postqueue -j`, one JSON object per line. Cached briefly because the overview
 * polls it; `maxAgeMs = 0` (the queue page) always asks Postfix.
 */
export async function queueSnapshot(maxAgeMs = 5000, timeoutMs = TIMEOUT_MS): Promise<QueueSnapshot> {
  if (cached && maxAgeMs > 0) {
    const ttl = cached.snapshot.available ? maxAgeMs : FAILURE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.snapshot;
  }
  try {
    const out = await run("queue", undefined, timeoutMs);
    const messages: QueueMessage[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      try {
        const m = toQueueMessage(JSON.parse(line) as PostqueueJson);
        if (m) messages.push(m);
      } catch {
        // postqueue prints "Mail queue is empty" and warnings as plain text
      }
    }
    messages.sort((a, b) => a.arrivalTime.localeCompare(b.arrivalTime));
    cached = { at: Date.now(), snapshot: { available: true, error: null, messages } };
  } catch (err) {
    cached = { at: Date.now(), snapshot: { available: false, error: (err as Error).message, messages: [] } };
  }
  return cached.snapshot;
}

export async function flushQueue(): Promise<void> {
  await run("flush");
  cached = null;
}

export async function queueAction(queueId: string, action: QueueAction): Promise<void> {
  await run(action, queueId);
  cached = null;
}
