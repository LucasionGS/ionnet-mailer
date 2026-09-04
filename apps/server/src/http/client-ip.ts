import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "../config.ts";

export function clientIp(c: Context): string {
  if (config.TRUST_PROXY) {
    const real = c.req.header("x-real-ip");
    if (real) return real.trim();
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
