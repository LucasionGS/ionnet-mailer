import { createHash, timingSafeEqual } from "node:crypto";
import { hash as bcryptHash, verify as bcryptVerify } from "@node-rs/bcrypt";

const PREFIX = "{BLF-CRYPT}";
const SHA512_PREFIX = "{SHA512-CRYPT}";

/** Produces a hash Dovecot's BLF-CRYPT scheme verifies: "{BLF-CRYPT}$2b$12$..." */
export async function hashPassword(password: string): Promise<string> {
  return PREFIX + (await bcryptHash(password, 12));
}

/**
 * Verifies BLF-CRYPT hashes, plus SHA512-CRYPT hashes ("{SHA512-CRYPT}$6$...")
 * imported from other Dovecot setups such as docker-mailserver.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith(SHA512_PREFIX)) return verifySha512Crypt(password, stored.slice(SHA512_PREFIX.length));
  if (stored.startsWith("$6$")) return verifySha512Crypt(password, stored);
  const raw = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length) : stored;
  if (!raw.startsWith("$2")) return false;
  try {
    return await bcryptVerify(password, raw);
  } catch {
    return false;
  }
}

/** True for hashes that should be replaced with a fresh BLF-CRYPT hash after a successful login. */
export function needsRehash(stored: string): boolean {
  const raw = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length) : stored;
  return !raw.startsWith("$2");
}

// ---- SHA512-CRYPT (glibc crypt "$6$", Ulrich Drepper's SHA-crypt spec) -------

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Byte order in which the final digest is base64-encoded, three bytes at a time.
const SHA512_ORDER = [
  [0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48],
  [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13],
  [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41],
] as const;

function verifySha512Crypt(password: string, stored: string): boolean {
  const m = /^\$6\$(?:rounds=(\d+)\$)?([^$]{0,16})\$[./0-9A-Za-z]{86}$/.exec(stored);
  if (!m) return false;
  const rounds = m[1] === undefined ? undefined : Math.min(Math.max(Number(m[1]), 1000), 999_999_999);
  const expected = Buffer.from(stored);
  const actual = Buffer.from(sha512Crypt(password, m[2]!, rounds));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sha512Crypt(password: string, saltStr: string, rounds?: number): string {
  const sha = (...parts: Buffer[]) => {
    const h = createHash("sha512");
    for (const p of parts) h.update(p);
    return h.digest();
  };
  // Repeats `block` until it is `len` bytes long.
  const stretch = (block: Buffer, len: number) => {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i += block.length) block.copy(out, i, 0, Math.min(block.length, len - i));
    return out;
  };

  const p = Buffer.from(password, "utf8");
  const s = Buffer.from(saltStr, "utf8");

  const b = sha(p, s, p);
  const a = createHash("sha512").update(p).update(s).update(stretch(b, p.length));
  for (let n = p.length; n > 0; n >>= 1) a.update(n & 1 ? b : p);
  let c = a.digest();

  const pBytes = stretch(sha(...Array<Buffer>(p.length).fill(p)), p.length);
  const sBytes = stretch(sha(...Array<Buffer>(16 + c[0]!).fill(s)), s.length);

  for (let i = 0; i < (rounds ?? 5000); i++) {
    const h = createHash("sha512");
    h.update(i & 1 ? pBytes : c);
    if (i % 3) h.update(sBytes);
    if (i % 7) h.update(pBytes);
    h.update(i & 1 ? c : pBytes);
    c = h.digest();
  }

  let out = "";
  const encode = (b2: number, b1: number, b0: number, chars: number) => {
    let w = (b2 << 16) | (b1 << 8) | b0;
    for (let i = 0; i < chars; i++, w >>= 6) out += ITOA64[w & 0x3f];
  };
  for (const [x, y, z] of SHA512_ORDER) encode(c[x]!, c[y]!, c[z]!, 4);
  encode(0, 0, c[63]!, 2);

  return `$6$${rounds === undefined ? "" : `rounds=${rounds}$`}${saltStr}$${out}`;
}
