import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import { outcomeFeedbackJson, wantsFeedbackJson } from "./outcome-feedback.ts";

// Mainnet agent 10315, feedback #2. The committed onchain feedbackHash must keep matching.
const EXECUTION = "0x55b2e18ff7e0995159672f4624451510079632662086fa3a65d3896ecced1862";
const OUTCOME = {
  status: "verified",
  observed: '{"arg0":"0x694178a2396b54bFF6a25caa0aA9Cca6Eb079441","arg1":"0xB925D44d52815D19C2f91c30f6aBD3B4D0546D4E","arg2":"10000000000000000"}',
  evidence: "0x9ad6de14a8c4c19944b28dc0d676a20460a167cef5883dd3824f9cc1b26b99b1",
};
const COMMITTED = "0x4b569ebdd223c07b867cc9c2d3c60153ac5445b8a9707a5e8104764680d5e998";

test("feedback document bytes hash to the committed onchain value", () => {
  assert.equal(keccak256(toBytes(outcomeFeedbackJson(EXECUTION, OUTCOME))), COMMITTED);
});

test("extra outcome fields never leak into the preimage, key order is fixed", () => {
  const doc = outcomeFeedbackJson(EXECUTION, { ...OUTCOME, reason: "x", expected: "y" } as typeof OUTCOME);
  assert.deepEqual(Object.keys(JSON.parse(doc)), ["executionId", "status", "observed", "evidence"]);
  assert.equal(keccak256(toBytes(doc)), COMMITTED);
});

test("content negotiation", () => {
  const req = (accept?: string, q = "") =>
    new Request(`https://x.test/outcomes/${EXECUTION}${q}`, { headers: accept ? { accept } : {} });
  assert.equal(wantsFeedbackJson(req("application/json")), true);
  assert.equal(wantsFeedbackJson(req("*/*")), true);
  assert.equal(wantsFeedbackJson(req()), true);
  assert.equal(wantsFeedbackJson(req("text/html,application/xhtml+xml,*/*;q=0.8")), false);
  assert.equal(wantsFeedbackJson(req("text/html", "?format=json")), true);
  assert.equal(wantsFeedbackJson(req("application/json", "?format=html")), false);
});
