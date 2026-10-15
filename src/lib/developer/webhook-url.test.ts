import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDeliverable, isNonPublicAddress, parseWebhookUrl } from "./webhook-url.ts";
import { signPayloadWithTimestamp, verifyWebhook } from "../../../sdk/src/webhooks/verify.ts";

test("webhook URL shape rules", () => {
  assert.equal(parseWebhookUrl("https://hooks.example.com/x"), "https://hooks.example.com/x");
  assert.equal(parseWebhookUrl("http://hooks.example.com/x"), null, "plain http to a public host");
  assert.equal(parseWebhookUrl("https://user:pw@hooks.example.com/"), null, "credentials");
  for (const bad of [
    "https://10.0.0.5/", "https://192.168.1.1/", "https://172.20.0.1/", "https://169.254.169.254/",
    "https://100.64.0.1/", "https://0.0.0.0/", "https://[::ffff:10.0.0.1]/", "https://[fd00::1]/",
    "https://[fe80::1]/", "https://metadata.google.internal/", "https://printer.local/", "ftp://example.com/",
  ]) {
    assert.equal(parseWebhookUrl(bad), null, bad);
  }
});

test("loopback only outside production", () => {
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    assert.ok(parseWebhookUrl("http://localhost:3000/hook"));
    assert.ok(parseWebhookUrl("http://127.0.0.1:3000/hook"));
    process.env.NODE_ENV = "production";
    assert.equal(parseWebhookUrl("http://localhost:3000/hook"), null);
    assert.equal(parseWebhookUrl("https://127.0.0.1/hook"), null);
    assert.equal(parseWebhookUrl("https://[::1]/hook"), null);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("non-public address classification", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.31.255.255", "192.168.0.1", "169.254.1.1", "::1", "fc00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isNonPublicAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) assert.equal(isNonPublicAddress(ip), false, ip);
});

test("delivery re-resolves DNS and blocks rebinding to private IPs", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.doesNotReject(assertDeliverable("https://hooks.example.com/", async () => [{ address: "93.184.216.34" }]));
    await assert.rejects(assertDeliverable("https://hooks.example.com/", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.7" }]));
    await assert.rejects(assertDeliverable("https://rebind.example.com/", async () => [{ address: "169.254.169.254" }]));
    await assert.rejects(assertDeliverable("https://empty.example.com/", async () => []));
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("timestamped webhook signatures reject replays", () => {
  const body = '{"id":"evt_1"}';
  const header = signPayloadWithTimestamp("whsec_x", body, 1_000);
  assert.equal(verifyWebhook(body, header, "whsec_x", { now: 1_100 }), true);
  assert.equal(verifyWebhook(body, header, "whsec_x", { now: 1_000 + 301 }), false, "too old");
  assert.equal(verifyWebhook(body, header, "whsec_wrong", { now: 1_000 }), false);
  assert.equal(verifyWebhook(body + " ", header, "whsec_x", { now: 1_000 }), false);
  assert.equal(verifyWebhook(body, header.replace("t=1000", "t=1100"), "whsec_x", { now: 1_100 }), false, "timestamp is signed");
});
