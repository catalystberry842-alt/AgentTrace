import { test } from "node:test";
import assert from "node:assert/strict";
import { isFirewallRef, namespacedFirewallId, parseExtraSources, splitFirewallRef } from "./firewall-sources.ts";

const V1 = "0x694178a2396b54bff6a25caa0aa9cca6eb079441";
const V3 = "0x06f7ba5b998e3b33ed8df7a936eac82ea95be50f";

test("unset env keeps only the primary contract", () => {
  assert.deepEqual(parseExtraSources(undefined, V1), []);
  assert.deepEqual(parseExtraSources("  ", V1), []);
});

test("extra sources parse key:address:block", () => {
  const list = parseExtraSources(`v3:${V3.toUpperCase().replace("0X", "0x")}:112960000, v3b:0x${"ab".repeat(20)}:113800000`, V1);
  assert.deepEqual(list, [
    { key: "v3", address: V3, deployBlock: 112960000 },
    { key: "v3b", address: `0x${"ab".repeat(20)}`, deployBlock: 113800000 },
  ]);
});

test("bad or duplicate extra sources are rejected", () => {
  assert.throws(() => parseExtraSources(`V3:${V3}:1`, V1), /bad key/);
  assert.throws(() => parseExtraSources(`v3:0x123:1`, V1), /bad address/);
  assert.throws(() => parseExtraSources(`v3:${V3}:x`, V1), /bad deploy block/);
  assert.throws(() => parseExtraSources(`v3:${V1}:1`, V1), /duplicate/, "primary address cannot be repeated");
  assert.throws(() => parseExtraSources(`v3:${V3}:1,v3:0x${"cd".repeat(20)}:2`, V1), /duplicate/);
});

test("primary ids stay plain; extra ids are namespaced and round-trip", () => {
  assert.equal(namespacedFirewallId("", "5"), "5");
  assert.equal(namespacedFirewallId("v3", "1"), "v3-1");
  assert.deepEqual(splitFirewallRef("5"), { key: "", id: "5" });
  assert.deepEqual(splitFirewallRef("v3-1"), { key: "v3", id: "1" });
  for (const ok of ["1", "42", "v3-1", "v3b-12"]) assert.equal(isFirewallRef(ok), true, ok);
  for (const bad of ["0", "v3-0", "-1", "V3-1", "v3_1", "1.5", "", "v3-", "x".repeat(17) + "-1"]) assert.equal(isFirewallRef(bad), false, bad);
});
