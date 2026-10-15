import { test } from "node:test";
import assert from "node:assert/strict";
import { quorumDeployBlock, readContracts, writeTarget } from "./proof-contracts.ts";

const LEGACY = "0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e";
const QUORUM = "0x21aa1604030b413c02f0f69304179f77bcd6adf6";

test("default: single-verifier AgentProof only (unchanged)", () => {
  assert.equal(writeTarget(LEGACY, {}), LEGACY);
  assert.deepEqual(readContracts(LEGACY, {}), [LEGACY]);
  assert.equal(writeTarget(LEGACY, { AGENT_PROOF_QUORUM_ADDRESS: "not-an-address" }), LEGACY);
});

test("quorum mode: attest to the quorum, read anchors from both (legacy first)", () => {
  const env = { AGENT_PROOF_QUORUM_ADDRESS: QUORUM.toUpperCase().replace("0X", "0x"), AGENT_PROOF_QUORUM_DEPLOY_BLOCK: "112999728" };
  assert.equal(writeTarget(LEGACY, env), QUORUM);
  assert.deepEqual(readContracts(LEGACY, env), [LEGACY, QUORUM]);
  assert.equal(quorumDeployBlock(env), 112999728);
  assert.deepEqual(readContracts(null, env), [QUORUM]);
  assert.deepEqual(readContracts(QUORUM, env), [QUORUM], "no duplicates");
});
