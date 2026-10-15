import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Webhook destination rules (SSRF guard).
 * - https only; plain http is allowed for loopback in non-production (local development).
 * - No credentials in the URL.
 * - The host must not be, or resolve to, a private, loopback, link-local, CGNAT, multicast or
 *   otherwise non-public address. Checked when the webhook is created AND before every delivery
 *   (DNS can change), and deliveries never follow redirects.
 */

const BLOCKED_NAMES = new Set(["metadata.google.internal", "metadata", "localhost.localdomain"]);

export function localWebhooksAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.AGENTTRACE_ALLOW_LOCAL_WEBHOOKS === "1";
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKED = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
];

export function isLoopback(ip: string): boolean {
  if (isIP(ip) === 4) return inV4(ip, "127.0.0.0/8");
  return ip === "::1";
}

/** True for any address a webhook must not reach. */
export function isNonPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return V4_BLOCKED.some((cidr) => inV4(ip, cidr));
  if (kind !== 6) return true;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isNonPublicAddress(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isNonPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (v6 === "::" || v6 === "::1") return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6) || v6.startsWith("64:ff9b:") || v6.startsWith("2001:db8:");
}

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

/** Synchronous shape check used when a webhook is registered. Returns the normalized URL or null. */
export function parseWebhookUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = bareHost(url);
  if (!host || BLOCKED_NAMES.has(host) || host.endsWith(".internal") || host.endsWith(".local")) return null;
  const loopbackName = host === "localhost" || (isIP(host) !== 0 && isLoopback(host));
  if (loopbackName) {
    if (!localWebhooksAllowed()) return null;
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  }
  if (url.protocol !== "https:") return null;
  if (isIP(host) !== 0 && isNonPublicAddress(host)) return null;
  return url.toString();
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = (host) => lookup(host, { all: true, verbatim: true });

/** Resolve the host and reject if any address is non-public. Run right before each delivery. */
export async function assertDeliverable(value: string, resolve: Lookup = defaultLookup): Promise<void> {
  const normalized = parseWebhookUrl(value);
  if (!normalized) throw new Error("Webhook URL is not allowed.");
  const host = bareHost(new URL(normalized));
  const addresses = isIP(host) !== 0 ? [{ address: host }] : await resolve(host);
  if (addresses.length === 0) throw new Error("Webhook host did not resolve.");
  for (const { address } of addresses) {
    if (isLoopback(address) && localWebhooksAllowed() && (host === "localhost" || isIP(host) !== 0)) continue;
    if (isNonPublicAddress(address)) throw new Error("Webhook host resolves to a non-public address.");
  }
}
