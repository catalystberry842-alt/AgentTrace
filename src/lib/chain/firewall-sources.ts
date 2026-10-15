/**
 * Several AgentFirewall contracts indexed side by side (V1, V3, a redeployed V3...).
 *
 * Firewall ids are per contract, so ids from extra contracts are stored namespaced as
 * `<key>-<id>` (e.g. `v3-1`). The primary contract (AGENT_FIREWALL_ADDRESS / the deployment
 * default) keeps plain numeric ids, so existing rows, URLs and proofs are unchanged.
 *
 * Extra contracts come from AGENT_FIREWALL_EXTRA_SOURCES, comma separated
 * `key:address:deployBlock`, e.g. `v3:0x06f7…e50f:112960000,v3b:0xabc…:113800000`.
 * Unset or empty means only the primary contract is indexed (current behaviour).
 */

export type FirewallSource = { key: string; address: `0x${string}`; deployBlock: number };

export const FIREWALL_REF_RE = /^(?:([a-z][a-z0-9]{0,15})-)?([1-9]\d*)$/;
const KEY_RE = /^[a-z][a-z0-9]{0,15}$/;

export function parseExtraSources(raw: string | undefined | null, primary?: string | null): FirewallSource[] {
  const out: FirewallSource[] = [];
  const seenKeys = new Set<string>();
  const seenAddrs = new Set<string>(primary ? [primary.toLowerCase()] : []);
  for (const part of (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const [key, address, block] = part.split(":").map((p) => p.trim());
    if (!KEY_RE.test(key ?? "")) throw new Error(`AGENT_FIREWALL_EXTRA_SOURCES: bad key in "${part}"`);
    if (!/^0x[a-fA-F0-9]{40}$/.test(address ?? "")) throw new Error(`AGENT_FIREWALL_EXTRA_SOURCES: bad address in "${part}"`);
    if (!/^\d+$/.test(block ?? "")) throw new Error(`AGENT_FIREWALL_EXTRA_SOURCES: bad deploy block in "${part}"`);
    const addr = address.toLowerCase() as `0x${string}`;
    if (seenKeys.has(key) || seenAddrs.has(addr)) throw new Error(`AGENT_FIREWALL_EXTRA_SOURCES: duplicate "${part}"`);
    seenKeys.add(key);
    seenAddrs.add(addr);
    out.push({ key, address: addr, deployBlock: Number(block) });
  }
  return out;
}

export function namespacedFirewallId(key: string, id: string): string {
  return key ? `${key}-${id}` : id;
}

/** Split a stored/URL firewall ref into its source key ("" = primary) and the onchain numeric id. */
export function splitFirewallRef(ref: string): { key: string; id: string } | null {
  const m = FIREWALL_REF_RE.exec(ref);
  if (!m) return null;
  return { key: m[1] ?? "", id: m[2] };
}

export function isFirewallRef(ref: string): boolean {
  return FIREWALL_REF_RE.test(ref);
}
