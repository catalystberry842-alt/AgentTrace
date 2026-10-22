import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import { PINNED_FEEDBACK_DOCS, pinnedFeedbackDocument } from "./pinned-feedback-docs.ts";

test("every pinned document hashes to the feedbackHash committed onchain", () => {
  assert.ok(PINNED_FEEDBACK_DOCS.length > 0);
  for (const d of PINNED_FEEDBACK_DOCS) {
    assert.equal(keccak256(toBytes(d.document)), d.feedbackHash, d.executionId);
  }
});

test("each document carries its own execution id and the fixed key order", () => {
  for (const d of PINNED_FEEDBACK_DOCS) {
    const parsed = JSON.parse(d.document);
    assert.equal(parsed.executionId, d.executionId);
    assert.deepEqual(Object.keys(parsed), ["executionId", "status", "observed", "evidence"]);
    assert.ok(["verified", "failed"].includes(parsed.status));
    assert.match(d.postedIn, /^0x[0-9a-f]{64}$/, "a full transaction hash, so the commitment can be read");
  }
});

test("lookup is case insensitive and returns null for anything not pinned", () => {
  const d = PINNED_FEEDBACK_DOCS[0]!;
  assert.equal(pinnedFeedbackDocument(d.executionId.toUpperCase().replace("0X", "0x")), d.document);
  assert.equal(pinnedFeedbackDocument(`0x${"ab".repeat(32)}`), null);
  assert.equal(pinnedFeedbackDocument(""), null);
});

test("no two pinned documents share an execution id or a hash", () => {
  assert.equal(new Set(PINNED_FEEDBACK_DOCS.map((d) => d.executionId)).size, PINNED_FEEDBACK_DOCS.length);
  assert.equal(new Set(PINNED_FEEDBACK_DOCS.map((d) => d.feedbackHash)).size, PINNED_FEEDBACK_DOCS.length);
});
