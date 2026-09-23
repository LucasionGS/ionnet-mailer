import type { AuditEntry } from "@ionnet/shared";
import { formatBytes } from "@ionnet/shared";

const FIELD_NAMES: Record<string, string> = {
  displayName: "display name",
  quotaBytes: "quota",
  isAdmin: "admin rights",
  active: "status",
  password: "password",
  catchAll: "catch-all",
  destination: "destination",
};

function changed(detail: Record<string, unknown> | null): string {
  const keys = Object.keys(detail ?? {}).map((k) => FIELD_NAMES[k] ?? k);
  return keys.length ? ` (${keys.join(", ")})` : "";
}

/** One sentence for an audit entry, e.g. "Reset the password of alice@example.com". */
export function describeAudit(a: AuditEntry): string {
  const t = a.target ?? "";
  const d = a.detail ?? {};
  switch (a.action) {
    case "domain.create":
      return `Added domain ${t}`;
    case "domain.delete":
      return `Deleted domain ${t}`;
    case "domain.update":
      if (d.active === false) return `Disabled domain ${t}`;
      if (d.active === true) return `Enabled domain ${t}`;
      if ("catchAll" in d) return d.catchAll ? `Set catch-all for ${t} to ${String(d.catchAll)}` : `Removed the catch-all of ${t}`;
      return `Changed domain ${t}${changed(d)}`;
    case "mailbox.create":
      return `Created mailbox ${t}${d.isAdmin ? " (administrator)" : ""}`;
    case "mailbox.delete":
      return `Deleted mailbox ${t}`;
    case "mailbox.update": {
      const keys = Object.keys(d);
      if (keys.length === 1 && d.active === false) return `Disabled mailbox ${t}`;
      if (keys.length === 1 && d.active === true) return `Enabled mailbox ${t}`;
      if (keys.length === 1 && "password" in d) return `Reset the password of ${t}`;
      if (keys.length === 1 && d.isAdmin === true) return `Made ${t} an administrator`;
      if (keys.length === 1 && d.isAdmin === false) return `Removed admin rights from ${t}`;
      if (keys.length === 1 && typeof d.quotaBytes === "number") return `Set the quota of ${t} to ${d.quotaBytes ? formatBytes(d.quotaBytes) : "unlimited"}`;
      return `Changed mailbox ${t}${changed(d)}`;
    }
    case "mailbox.quota_recalc":
      return `Recalculated the storage used by ${t}${typeof d.usedBytes === "number" ? ` (${formatBytes(d.usedBytes)})` : ""}`;
    case "alias.create":
      return `Added alias ${t} → ${String(d.destination ?? "")}`;
    case "alias.update":
      if (d.active === false) return `Disabled alias ${t}`;
      if (d.active === true) return `Enabled alias ${t}`;
      return `Changed alias ${t}${changed(d)}`;
    case "alias.delete":
      return `Deleted alias ${t}`;
    case "lockout.remove":
      return `Lifted the sign-in lockout for ${t.replace(/^(ip|user):/, "")}`;
    case "session.revoke":
      return `Signed out a web session of ${t}`;
    case "queue.flush":
      return "Retried all queued mail";
    case "queue.retry":
      return `Retried queued message ${t}`;
    case "queue.hold":
      return `Put queued message ${t} on hold`;
    case "queue.release":
      return `Released queued message ${t}`;
    case "queue.delete":
      return `Deleted queued message ${t}`;
    case "setup.report_addresses": {
      const addresses = Array.isArray(d.addresses) ? d.addresses.map(String) : [];
      return `Pointed ${addresses.length ? addresses.join(", ") : "the report addresses"} at ${t}`;
    }
    case "setup.skip":
      return `Skipped setup step ${t}`;
    case "setup.reopen":
      return `Reopened setup step ${t}`;
    case "account.password_change":
      return "Changed their own password";
    default:
      return `${a.action}${t ? ` ${t}` : ""}`;
  }
}
