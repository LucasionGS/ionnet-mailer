import { generateKeyPairSync } from "node:crypto";
import { chmod, chown, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";
import { Domain } from "../db/models.ts";
import { logger } from "../logger.ts";

const log = logger("dkim");

export function generateDkimKeyPair(): { privateKeyPem: string; publicKeyB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { privateKeyPem, publicKeyB64 };
}

const keyPath = (d: Pick<Domain, "name" | "dkimSelector">) => path.join(config.DKIM_DIR, `${d.name}.${d.dkimSelector}.key`);
const mapPath = () => path.join(config.DKIM_DIR, "selectors.map");

async function writeSelectorMap(domains: Array<Pick<Domain, "name" | "dkimSelector">>) {
  const body = domains.map((d) => `${d.name} ${d.dkimSelector}`).join("\n") + (domains.length ? "\n" : "");
  await writeFile(mapPath(), body, { mode: 0o644 });
}

async function setOwnership(file: string, mode: number) {
  await chmod(file, mode);
  if (config.DKIM_GID !== undefined) {
    try {
      await chown(file, process.getuid?.() ?? 0, config.DKIM_GID);
    } catch (err) {
      log.debug(`chown ${file} failed: ${(err as Error).message}`);
    }
  }
}

/** Writes this domain's private key where rspamd's dkim_signing module expects it. */
export async function materializeDomainKey(domain: Domain): Promise<void> {
  await mkdir(config.DKIM_DIR, { recursive: true });
  const file = keyPath(domain);
  let current: string | null = null;
  try {
    current = await readFile(file, "utf8");
  } catch {
    current = null;
  }
  if (current !== domain.dkimPrivateKeyPem) {
    await writeFile(file, domain.dkimPrivateKeyPem, { mode: 0o640 });
  }
  await setOwnership(file, 0o640);
}

export async function removeDomainKey(domain: Pick<Domain, "name" | "dkimSelector">): Promise<void> {
  await rm(keyPath(domain), { force: true });
  await syncSelectorMap();
}

export async function syncSelectorMap(): Promise<void> {
  const domains = await Domain.findAll({ where: { active: true }, attributes: ["name", "dkimSelector"] });
  await mkdir(config.DKIM_DIR, { recursive: true });
  await writeSelectorMap(domains);
  await setOwnership(mapPath(), 0o644);
}

/** On boot: make sure every domain's key exists on the shared volume (handles fresh volumes). */
export async function materializeAllKeys(): Promise<void> {
  try {
    const domains = await Domain.findAll();
    for (const d of domains) await materializeDomainKey(d);
    await syncSelectorMap();
    log.info(`DKIM keys ready for ${domains.length} domain(s) in ${config.DKIM_DIR}`);
  } catch (err) {
    log.error("could not materialize DKIM keys", err);
  }
}
