import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFirewallAddress, TRACE_NETWORKS } from "./trace.ts";

test("default stays on the V1 firewall (unchanged behaviour)", () => {
  assert.equal(resolveFirewallAddress("monad-mainnet"), TRACE_NETWORKS["monad-mainnet"].firewall);
  assert.equal(resolveFirewallAddress("monad-testnet", { firewallVersion: "v1" }), TRACE_NETWORKS["monad-testnet"].firewall);
});

test("v3 selects the recorded V3 deployment", () => {
  assert.equal(resolveFirewallAddress("monad-mainnet", { firewallVersion: "v3" }), "0x06f7ba5b998e3b33ed8df7a936eac82ea95be50f");
  assert.throws(() => resolveFirewallAddress("monad-testnet", { firewallVersion: "v3" }), /No AgentFirewallV3/);
});

test("explicit address wins and is validated", () => {
  const addr = `0x${"Ab".repeat(20)}` as `0x${string}`;
  assert.equal(resolveFirewallAddress("monad-testnet", { firewallVersion: "v3", firewallAddress: addr }), addr.toLowerCase());
  assert.throws(() => resolveFirewallAddress("monad-mainnet", { firewallAddress: "0x123" as `0x${string}` }), /must be an address/);
});
