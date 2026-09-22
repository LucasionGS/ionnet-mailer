import { open, stat, type FileHandle } from "node:fs/promises";
import { getSetting, setSetting } from "../db/models.ts";
import { logger } from "../logger.ts";

const log = logger("log-tail");
const POLL_MS = 1000;
const SAVE_MS = 5000;
const CHUNK = 256 * 1024;

interface State {
  ino: number;
  pos: number;
}

/**
 * Follows a log file like `tail -F`: it survives rotation (new inode) and
 * truncation, and remembers how far it got in app_settings so a restart
 * continues where it stopped instead of re-reading or skipping lines.
 */
export class LogTailer {
  readonly path: string;
  readonly stateKey: string;
  readonly onLine: (line: string) => Promise<void>;
  private fh: FileHandle | null = null;
  private ino = 0;
  /** file offset of the first byte not yet read */
  private pos = 0;
  private partial: Buffer = Buffer.alloc(0);
  private savedPos = -1;
  private lastSave = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private missingLogged = false;

  constructor(path: string, stateKey: string, onLine: (line: string) => Promise<void>) {
    this.path = path;
    this.stateKey = stateKey;
    this.onLine = onLine;
  }

  start(): void {
    const loop = async () => {
      try {
        await this.tick();
      } catch (err) {
        log.warn(`${this.path}: ${(err as Error).message}`);
      }
      if (!this.stopped) this.timer = setTimeout(loop, POLL_MS);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.save(true).catch(() => undefined);
    await this.fh?.close().catch(() => undefined);
    this.fh = null;
  }

  private async tick(): Promise<void> {
    let st;
    try {
      st = await stat(this.path);
    } catch {
      if (!this.missingLogged) log.info(`${this.path} does not exist yet; waiting for it`);
      this.missingLogged = true;
      return;
    }
    this.missingLogged = false;

    if (!this.fh) {
      const saved = await this.loadState();
      const resume = saved && saved.ino === st.ino && saved.pos <= st.size ? saved.pos : 0;
      await this.openFile(st.ino, resume);
      if (resume) log.info(`resuming ${this.path} at byte ${resume}`);
    } else if (st.ino !== this.ino) {
      // Rotated: finish the old file through the handle we still hold, then switch.
      await this.drain();
      await this.fh.close();
      await this.openFile(st.ino, 0);
    } else if (st.size < this.pos) {
      log.info(`${this.path} was truncated; reading from the start`);
      this.pos = 0;
      this.partial = Buffer.alloc(0);
    }
    await this.drain();
    await this.save(false);
  }

  private async openFile(ino: number, pos: number): Promise<void> {
    this.fh = await open(this.path, "r");
    this.ino = ino;
    this.pos = pos;
    this.partial = Buffer.alloc(0);
  }

  private async drain(): Promise<void> {
    const fh = this.fh;
    if (!fh) return;
    const buf = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, this.pos);
      if (bytesRead === 0) return;
      this.pos += bytesRead;
      let data = Buffer.concat([this.partial, buf.subarray(0, bytesRead)]);
      let nl: number;
      while ((nl = data.indexOf(0x0a)) !== -1) {
        const line = data.subarray(0, nl).toString("utf8").replace(/\r$/, "");
        data = data.subarray(nl + 1);
        if (line) {
          try {
            await this.onLine(line);
          } catch (err) {
            log.warn(`could not process line from ${this.path}: ${(err as Error).message}`);
          }
        }
      }
      // Copy so the next read into `buf` can't overwrite the remainder.
      this.partial = Buffer.from(data);
    }
  }

  private async loadState(): Promise<State | null> {
    try {
      const raw = await getSetting(this.stateKey);
      const s = raw ? (JSON.parse(raw) as Partial<State>) : null;
      return s && typeof s.ino === "number" && typeof s.pos === "number" ? { ino: s.ino, pos: s.pos } : null;
    } catch {
      return null;
    }
  }

  private async save(force: boolean): Promise<void> {
    if (!this.fh) return;
    const done = this.pos - this.partial.length; // end of the last complete line
    if (done === this.savedPos || (!force && Date.now() - this.lastSave < SAVE_MS)) return;
    await setSetting(this.stateKey, JSON.stringify({ ino: this.ino, pos: done } satisfies State));
    this.savedPos = done;
    this.lastSave = Date.now();
  }
}
