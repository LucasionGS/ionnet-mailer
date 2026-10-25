import net, { BlockList } from "node:net";
import { Op, QueryTypes } from "sequelize";
import type { AutoBanPolicy, IpBan, IpBanList } from "@ionnet/shared";
import { config } from "../config.ts";
import { IpBanRow, getSetting, setSetting } from "../db/models.ts";
import { sequelize } from "../db/sequelize.ts";
import { badRequest } from "../errors.ts";
import { logger } from "../logger.ts";

const log = logger("bans");

const ALLOWLIST_SETTING = "ban_allowlist";
/** Active bans are cached this long; every change made here refreshes the cache at once. */
const CACHE_MS = 15_000;
/** Repeat offenders: the second ban lasts 7x the first, the third and later 30x. */
const ESCALATION = [1, 7, 30];
const REPEAT_LOOKBACK_DAYS = 90;
/** An account that signed in successfully from the address this recently doesn't count towards a ban. */
const SUCCESS_GRACE_HOURS = 24;

const ACTIVE = "lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())";

export function autoBanPolicy(): AutoBanPolicy {
  return {
    enabled: config.AUTOBAN_ENABLED,
    windowMinutes: config.AUTOBAN_WINDOW_MINUTES,
    distinctAccounts: config.AUTOBAN_DISTINCT_ACCOUNTS,
    failures: config.AUTOBAN_FAILURES,
    durationHours: config.AUTOBAN_DURATION_HOURS,
    slowWindowHours: config.AUTOBAN_SLOW_WINDOW_HOURS,
    unknownFailures: config.AUTOBAN_UNKNOWN_FAILURES,
    networkAddresses: config.AUTOBAN_NETWORK_ADDRESSES,
  };
}

interface Network {
  address: string;
  prefix: number;
  family: "ipv4" | "ipv6";
}

/** Strips the IPv4-mapped IPv6 prefix Node and Dovecot sometimes report ("::ffff:1.2.3.4"). */
function plainIp(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip.trim());
  return m ? m[1]! : ip.trim();
}

/** Parses "1.2.3.4", "1.2.3.0/24" or an IPv6 equivalent; null when it is neither. */
export function parseNetwork(input: string): Network | null {
  const [rawAddress, rawPrefix, ...rest] = input.trim().split("/");
  if (rest.length || !rawAddress) return null;
  const address = plainIp(rawAddress);
  const version = net.isIP(address);
  if (!version) return null;
  const max = version === 4 ? 32 : 128;
  const prefix = rawPrefix === undefined ? max : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (rawPrefix !== undefined && !/^\d+$/.test(rawPrefix))) return null;
  return { address, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}

/** "1.2.3.4/32" -> "1.2.3.4": single addresses read better without their prefix. */
export function displayNetwork(cidr: string): string {
  return cidr.replace(/\/(32|128)$/, "");
}

function addTo(list: BlockList, n: Network) {
  if (n.prefix === (n.family === "ipv4" ? 32 : 128)) list.addAddress(n.address, n.family);
  else list.addSubnet(n.address, n.prefix, n.family);
}

function contains(list: BlockList, ip: string): boolean {
  const addr = plainIp(ip);
  const version = net.isIP(addr);
  if (!version) return false;
  return list.check(addr, version === 4 ? "ipv4" : "ipv6");
}

/** Whether the address or network `network` covers `ip`. */
export function networkContains(network: string, ip: string): boolean {
  const n = parseNetwork(network);
  if (!n) return false;
  const list = new BlockList();
  addTo(list, n);
  return contains(list, ip);
}

// ---- allowlist ------------------------------------------------------------------------
/** Loopback, private ranges reached through Docker's port publishing, and the compose network are never banned. */
const BUILTIN_ALLOW = ["127.0.0.0/8", "::1/128", config.MAIL_NETWORK_SUBNET];

let allowCache: { at: number; list: BlockList; entries: string[] } | null = null;

export async function getAllowlist(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await getSetting(ALLOWLIST_SETTING)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function setAllowlist(entries: string[]): Promise<string[]> {
  const clean: string[] = [];
  for (const e of entries) {
    const n = parseNetwork(e);
    if (!n) throw badRequest(`"${e}" is not an IP address or network`);
    const text = n.prefix === (n.family === "ipv4" ? 32 : 128) ? n.address : `${n.address}/${n.prefix}`;
    if (!clean.includes(text)) clean.push(text);
  }
  await setSetting(ALLOWLIST_SETTING, JSON.stringify(clean));
  allowCache = null;
  return clean;
}

async function allowList(): Promise<BlockList> {
  if (allowCache && Date.now() - allowCache.at < CACHE_MS) return allowCache.list;
  const entries = [...BUILTIN_ALLOW, ...config.AUTOBAN_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean), ...(await getAllowlist())];
  const list = new BlockList();
  for (const e of entries) {
    const n = parseNetwork(e);
    if (n) addTo(list, n);
    else log.warn(`ignoring invalid allowlist entry "${e}"`);
  }
  allowCache = { at: Date.now(), list, entries };
  return list;
}

export async function isAllowlisted(ip: string): Promise<boolean> {
  return contains(await allowList(), ip);
}

/** Whether any allowlisted address falls inside `network`, so banning the network would ban it too. */
async function networkTouchesAllowlist(network: string): Promise<boolean> {
  await allowList();
  const n = parseNetwork(network);
  if (!n) return true;
  const range = new BlockList();
  addTo(range, n);
  return (allowCache?.entries ?? []).some((e) => {
    const a = parseNetwork(e);
    return !!a && a.family === n.family && (range.check(a.address, a.family) || contains(allowCache!.list, n.address));
  });
}

// ---- active bans --------------------------------------------------------------------
let banCache: { at: number; list: BlockList } | null = null;
let banLoad: Promise<BlockList> | null = null;

async function activeBanList(): Promise<BlockList> {
  if (banCache && Date.now() - banCache.at < CACHE_MS) return banCache.list;
  banLoad ??= (async () => {
    try {
      const rows = await sequelize.query<{ network: string }>(`SELECT network::text AS network FROM ip_bans WHERE ${ACTIVE}`, { type: QueryTypes.SELECT });
      const list = new BlockList();
      for (const r of rows) {
        const n = parseNetwork(r.network);
        if (n) addTo(list, n);
      }
      banCache = { at: Date.now(), list };
      return list;
    } finally {
      banLoad = null;
    }
  })();
  return banLoad;
}

function invalidateBans() {
  banCache = null;
}

/** Whether `ip` is inside an active ban. Never throws: if the database is unreachable, nobody is banned. */
export async function isBanned(ip: string | null | undefined): Promise<boolean> {
  if (!ip || ip === "unknown") return false;
  try {
    return contains(await activeBanList(), ip);
  } catch (err) {
    log.warn(`could not check bans: ${(err as Error).message}`);
    return false;
  }
}

/** Counts an attempt that a ban turned away. */
export async function recordBanHit(ip: string): Promise<void> {
  const addr = plainIp(ip);
  if (!net.isIP(addr)) return;
  await sequelize
    .query(`UPDATE ip_bans SET hits = hits + 1, last_hit_at = now() WHERE network >>= :ip::inet AND ${ACTIVE}`, { replacements: { ip: addr } })
    .catch((err: Error) => log.warn(`could not count ban hit: ${err.message}`));
}

// ---- automatic bans -----------------------------------------------------------------
const evaluating = new Set<string>();
/** An address, or any address in a network, that signed in successfully this recently is spared the slow rules. */
const TRUSTED_SUCCESS_DAYS = 7;
const FAILED = "NOT success AND coalesce(reason, '') <> 'banned'";
/** Rows whose ip lies in :net (a cidr). The CASE keeps a stray non-address value from failing the whole query. */
const IN_NET = "CASE WHEN pg_input_is_valid(ip, 'inet') THEN ip::inet <<= :net::cidr ELSE false END";

/** The /24 (IPv4) or /64 (IPv6) around `addr`, which bot farms tend to rotate through. */
async function surroundingNetwork(addr: string): Promise<string> {
  const [row] = await sequelize.query<{ net: string }>("SELECT network(set_masklen(:ip::inet, :bits))::text AS net", {
    replacements: { ip: addr, bits: net.isIPv4(addr) ? 24 : 64 },
    type: QueryTypes.SELECT,
  });
  return row!.net;
}

/** Bans `network` with the escalating duration, unless an active ban already covers it. */
async function autoBan(network: string, reason: string): Promise<IpBanRow | null> {
  const [covered] = await sequelize.query<{ n: number }>(`SELECT count(*)::int AS n FROM ip_bans WHERE network >>= :net::cidr AND ${ACTIVE}`, {
    replacements: { net: network },
    type: QueryTypes.SELECT,
  });
  if (covered && covered.n > 0) return null;
  const previous = await IpBanRow.count({
    where: { network, source: "auto", createdAt: { [Op.gt]: new Date(Date.now() - REPEAT_LOOKBACK_DAYS * 86_400_000) } },
  });
  const hours = config.AUTOBAN_DURATION_HOURS * ESCALATION[Math.min(previous, ESCALATION.length - 1)]!;
  const ban = await IpBanRow.create({
    network,
    reason: previous ? `${reason}; banned ${previous} time(s) before` : reason,
    source: "auto",
    createdBy: null,
    expiresAt: new Date(Date.now() + hours * 3600_000),
  });
  invalidateBans();
  log.warn(`banned ${displayNetwork(network)} for ${hours} hours: ${ban.reason}`);
  return ban;
}

/**
 * Called after every failed sign-in. Bans the address when it
 * - failed for too many different accounts (existing or not) within the window, or too often overall, or
 * - kept trying accounts that don't exist over the slow window (bots that try one name every few hours), or
 * - is one of several addresses in the same /24 (or /64) trying accounts that don't exist: then the whole network.
 * The slow rules spare addresses and networks that signed in successfully in the last week. Never throws.
 */
export async function evaluateAutoBan(ip: string | null | undefined): Promise<IpBanRow | null> {
  if (!config.AUTOBAN_ENABLED || !ip || ip === "unknown") return null;
  const addr = plainIp(ip);
  if (!net.isIP(addr) || evaluating.has(addr)) return null;
  evaluating.add(addr);
  try {
    if ((await isAllowlisted(addr)) || (await isBanned(addr))) return null;
    const [stats] = await sequelize.query<{ accounts: number; failures: number; unknown: number; trusted: boolean; sources: string[] | null }>(
      `SELECT count(DISTINCT username) FILTER (
                WHERE last_at > now() - make_interval(mins => :window) AND username IS NOT NULL AND username NOT IN (
                  SELECT username FROM auth_events
                   WHERE ip = :ip AND success AND username IS NOT NULL AND last_at > now() - make_interval(hours => :grace)
                )
              )::int AS accounts,
              coalesce(sum(count) FILTER (WHERE last_at > now() - make_interval(mins => :window)), 0)::int AS failures,
              coalesce(sum(count) FILTER (WHERE reason = 'unknown_user'), 0)::int AS unknown,
              EXISTS (SELECT 1 FROM auth_events WHERE ip = :ip AND success AND last_at > now() - make_interval(days => :trusted)) AS trusted,
              array_agg(DISTINCT source) AS sources
         FROM auth_events
        WHERE ip = :ip AND ${FAILED} AND last_at > now() - make_interval(hours => :slow)`,
      {
        replacements: {
          ip: addr,
          window: config.AUTOBAN_WINDOW_MINUTES,
          grace: SUCCESS_GRACE_HOURS,
          slow: config.AUTOBAN_SLOW_WINDOW_HOURS,
          trusted: TRUSTED_SUCCESS_DAYS,
        },
        type: QueryTypes.SELECT,
      },
    );
    if (!stats) return null;
    const via = (stats.sources ?? []).join(", ");
    const single = `${addr}/${net.isIPv4(addr) ? 32 : 128}`;
    if (stats.accounts >= config.AUTOBAN_DISTINCT_ACCOUNTS) {
      return autoBan(single, `Failed sign-ins for ${stats.accounts} different accounts within ${config.AUTOBAN_WINDOW_MINUTES} minutes (${via})`);
    }
    if (stats.failures >= config.AUTOBAN_FAILURES) {
      return autoBan(single, `${stats.failures} failed sign-ins within ${config.AUTOBAN_WINDOW_MINUTES} minutes (${via})`);
    }
    if (stats.trusted) return null;

    // Bot farms spread the guessing over many addresses of one network, each trying a name every few hours.
    const network = await surroundingNetwork(addr);
    if (config.AUTOBAN_NETWORK_ADDRESSES > 0 && !(await networkTouchesAllowlist(network))) {
      const [netStats] = await sequelize.query<{ ips: number; trusted: boolean }>(
        `SELECT count(DISTINCT ip) FILTER (WHERE ${FAILED} AND reason = 'unknown_user')::int AS ips,
                bool_or(success AND last_at > now() - make_interval(days => :trusted)) AS trusted
           FROM auth_events
          WHERE ${IN_NET} AND (success OR last_at > now() - make_interval(hours => :slow))`,
        { replacements: { net: network, slow: config.AUTOBAN_SLOW_WINDOW_HOURS, trusted: TRUSTED_SUCCESS_DAYS }, type: QueryTypes.SELECT },
      );
      if (netStats && !netStats.trusted && netStats.ips >= config.AUTOBAN_NETWORK_ADDRESSES) {
        return autoBan(network, `${netStats.ips} addresses in this network tried accounts that don't exist within ${config.AUTOBAN_SLOW_WINDOW_HOURS} hours (${via})`);
      }
    }
    if (config.AUTOBAN_UNKNOWN_FAILURES > 0 && stats.unknown >= config.AUTOBAN_UNKNOWN_FAILURES) {
      return autoBan(single, `${stats.unknown} sign-ins to accounts that don't exist within ${config.AUTOBAN_SLOW_WINDOW_HOURS} hours (${via})`);
    }
    return null;
  } catch (err) {
    log.warn(`auto-ban check for ${addr} failed: ${(err as Error).message}`);
    return null;
  } finally {
    evaluating.delete(addr);
  }
}

// ---- admin ----------------------------------------------------------------------------
export function toIpBanDto(r: IpBanRow): IpBan {
  const now = Date.now();
  return {
    id: String(r.id),
    network: displayNetwork(r.network),
    reason: r.reason,
    source: r.source === "manual" ? "manual" : "auto",
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    liftedAt: r.liftedAt?.toISOString() ?? null,
    liftedBy: r.liftedBy ?? null,
    hits: r.hits,
    lastHitAt: r.lastHitAt?.toISOString() ?? null,
    active: !r.liftedAt && (!r.expiresAt || r.expiresAt.getTime() > now),
  };
}

export async function listBans(includeInactive: boolean): Promise<IpBanList> {
  const where = includeInactive ? {} : { liftedAt: null, [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] };
  const rows = await IpBanRow.findAll({ where, order: [["id", "DESC"]], limit: includeInactive ? 500 : 2000 });
  return { bans: rows.map(toIpBanDto), allowlist: await getAllowlist(), policy: autoBanPolicy() };
}

/** Bans `input` (an address or network) by hand; an existing active ban for the same network is replaced. */
export async function createBan(input: string, hours: number | null, reason: string | null, by: string | null): Promise<IpBanRow> {
  const n = parseNetwork(input);
  if (!n) throw badRequest(`"${input}" is not an IP address or network`);
  // Postgres rejects host bits in a cidr ("1.2.3.4/24"); network() turns it into "1.2.3.0/24".
  const [row] = await sequelize.query<{ network: string }>("SELECT network(:n::inet)::text AS network", {
    replacements: { n: `${n.address}/${n.prefix}` },
    type: QueryTypes.SELECT,
  });
  const network = row!.network;
  await sequelize.query(`UPDATE ip_bans SET lifted_at = now(), lifted_by = :by WHERE network = :network::cidr AND ${ACTIVE}`, {
    replacements: { network, by: by ?? "system" },
  });
  const ban = await IpBanRow.create({
    network,
    reason: reason || null,
    source: "manual",
    createdBy: by,
    expiresAt: hours === null ? null : new Date(Date.now() + hours * 3600_000),
  });
  invalidateBans();
  return ban;
}

export async function liftBan(id: string, by: string | null): Promise<IpBanRow | null> {
  if (!/^\d+$/.test(id)) return null;
  const ban = await IpBanRow.findByPk(id);
  if (!ban) return null;
  if (!ban.liftedAt) {
    ban.liftedAt = new Date();
    ban.liftedBy = by ?? "system";
    await ban.save();
  }
  invalidateBans();
  return ban;
}

/** Lifts every active ban covering `ip`; used by the recovery CLI. Returns how many were lifted. */
export async function liftBansFor(ip: string, by: string | null): Promise<number> {
  const n = parseNetwork(ip);
  if (!n) throw badRequest(`"${ip}" is not an IP address or network`);
  const [, count] = await sequelize.query(
    `UPDATE ip_bans SET lifted_at = now(), lifted_by = :by WHERE (network >>= :n::inet OR network <<= :n::inet) AND ${ACTIVE}`,
    { replacements: { n: `${n.address}/${n.prefix}`, by: by ?? "system" } },
  );
  invalidateBans();
  return typeof count === "number" ? count : ((count as { rowCount?: number })?.rowCount ?? 0);
}
