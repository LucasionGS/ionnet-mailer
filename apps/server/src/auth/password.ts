import { hash as bcryptHash, verify as bcryptVerify } from "@node-rs/bcrypt";

const PREFIX = "{BLF-CRYPT}";

/** Produces a hash Dovecot's BLF-CRYPT scheme verifies: "{BLF-CRYPT}$2b$12$..." */
export async function hashPassword(password: string): Promise<string> {
  return PREFIX + (await bcryptHash(password, 12));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const raw = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length) : stored;
  if (!raw.startsWith("$2")) return false;
  try {
    return await bcryptVerify(password, raw);
  } catch {
    return false;
  }
}
