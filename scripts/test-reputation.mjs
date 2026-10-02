import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";

const root = join(import.meta.dirname, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(path);
  }
  return out;
}

const banned = ["trusted agent", "safe agent", "reliable agent", "best agent", "leaderboard", "most trusted"];
for (const file of walk(join(root, "src/routes")).concat(walk(join(root, "src/components")))) {
  const text = readFileSync(file, "utf8").toLowerCase();
  for (const phrase of banned) assert.equal(text.includes(phrase), false, `${file} contains ${phrase}`);
}

const reputationApi = readFileSync(join(root, "src/routes/api/agents/$agentId/reputation.ts"), "utf8");
const browseApi = readFileSync(join(root, "src/routes/api/reputation/index.ts"), "utf8");
assert.equal(reputationApi.includes("POST"), false);
assert.equal(browseApi.includes("POST"), false);
assert.equal(reputationApi.includes("requireUserId"), false);
assert.equal(browseApi.includes("requireUserId"), false);

const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const db = await vite.ssrLoadModule("/src/lib/db.ts");
  const network = await vite.ssrLoadModule("/src/lib/chain/network.ts");
  const reputation = await vite.ssrLoadModule("/src/lib/chain/reputation.server.ts");
  const sql = await db.getSql();
  const chain = network.MONAD_TESTNET.chainId;
  const addr = "0x0000000000000000000000000000000000000001";
  const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;

  async function addAgent(id, active = true) {
    await sql`
      insert into indexed_agents (
        chain_id, agent_id, owner, name, description, metadata_uri, capabilities,
        registered_at, registered_block, active, tx_hash
      ) values (
        ${chain}, ${id}, ${addr}, ${`Agent ${id}`}, 'Records.', '', '[]'::jsonb,
        now() - interval '2 days', 1, ${active}, ${hash(9)}
      )
    `;
  }

  async function addAction(agentId, n, when = "now()") {
    const id = hash(n);
    await sql.query(
      `insert into firewall_actions (
        chain_id, execution_id, firewall_id, agent_id, executor, target, selector, value,
        execution_nonce, calldata_hash, executed_at, tx_hash, log_index, block_number
      ) values ($1,$2,'1',$3,$4,$4,'0xa9059cbb','0','0',$5, ${when}, $6, $7, $8)
      on conflict (chain_id, execution_id) do nothing`,
      [chain, id, agentId, addr, hash(1000 + n), hash(2000 + n), n, n],
    );
    return id;
  }

  async function addProof(agentId, executionId, n, status) {
    await sql.query(
      `insert into execution_proofs (
        chain_id, proof_id, execution_id, agent_id, firewall_id, executor, tx_hash, block_number,
        target, function_selector, value, calldata_hash, verification_status, anchored
      ) values ($1,$2,$3,$4,'1',$5,$6,$7,$5,'0xa9059cbb','0',$8,$9,false)
      on conflict (chain_id, execution_id) do nothing`,
      [chain, hash(3000 + n), executionId, agentId, addr, hash(2000 + n), n, hash(4000 + n), status],
    );
  }

  async function addOutcome(agentId, executionId, id, status, expected = "", observed = "", reason = "") {
    await sql.query(
      `insert into execution_outcomes (
        chain_id, outcome_id, execution_id, agent_id, status, expected, observed, evidence, reason, verified_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
      on conflict (chain_id, outcome_id) do nothing`,
      [chain, id, executionId, agentId, status, expected, observed, "receipt", reason],
    );
  }

  await addAgent("9");
  const empty = await reputation.deriveAgentReputation("9");
  assert.equal(empty.totalExecutions, 0);
  assert.equal(empty.verifiedExecutions, 0);
  assert.equal(empty.verifiedOutcomes, 0);
  assert.equal(empty.failedOutcomes, 0);
  assert.equal(empty.unverifiableOutcomes, 0);
  assert.equal(empty.firstActivityAt, null);
  assert.equal(empty.lastActivityAt, null);

  await addAgent("1");
  const first = await addAction("1", 1, "now() - interval '1 day'");
  let history = await reputation.deriveAgentReputation("1");
  assert.equal(history.totalExecutions, 1);
  assert.equal(history.verifiedExecutions, 0);
  await addAction("1", 1, "now() - interval '1 day'");
  history = await reputation.deriveAgentReputation("1");
  assert.equal(history.totalExecutions, 1, "duplicate AgentAction");

  await addProof("1", first, 1, "executed");
  history = await reputation.deriveAgentReputation("1");
  assert.equal(history.verifiedExecutions, 0, "unverified execution");
  await sql`update execution_proofs set verification_status = 'receipt_verified' where execution_id = ${first}`;
  history = await reputation.deriveAgentReputation("1");
  assert.equal(history.verifiedExecutions, 1);
  await addProof("1", first, 1, "receipt_verified");
  history = await reputation.deriveAgentReputation("1");
  assert.equal(history.verifiedExecutions, 1, "duplicate proof");

  const second = await addAction("1", 2);
  await addProof("1", second, 2, "receipt_verified");
  history = await reputation.deriveAgentReputation("1");
  assert.equal(history.totalExecutions, 2);
  assert.equal(history.verifiedExecutions, 2);

  await addOutcome("1", first, "out-ok", "verified");
  await addOutcome("1", first, "out-ok", "verified");
  await addOutcome("1", second, "out-bad", "failed", "balance > 0", "balance = 0");
  await addOutcome("1", second, "out-unknown", "unverifiable", "", "", "No supported verification adapter exists for this protocol.");
  history = await reputation.deriveAgentReputation("1");
  assert.equal(history.verifiedOutcomes, 1);
  assert.equal(history.failedOutcomes, 1);
  assert.equal(history.unverifiableOutcomes, 1);
  assert.equal(history.verifiedOutcomes + history.failedOutcomes, 2);
  assert.ok(history.firstActivityAt);
  assert.ok(history.lastActivityAt);

  const again = await reputation.deriveAgentReputation("1");
  assert.equal(again.verifiedExecutions, history.verifiedExecutions);
  assert.equal(again.failedOutcomes, history.failedOutcomes);
  await sql`delete from execution_proofs where execution_id = ${second}`;
  const rebuilt = await reputation.deriveAgentReputation("1");
  assert.equal(rebuilt.totalExecutions, 2);
  assert.equal(rebuilt.verifiedExecutions, 1, "rebuild follows remaining proofs");
  await addProof("1", second, 2, "receipt_verified");

  await sql`update indexed_agents set active = false, deactivation_tx_hash = ${hash(8)} where agent_id = '1'`;
  const retired = await reputation.deriveAgentReputation("1");
  assert.equal(retired.totalExecutions, 2);
  assert.equal(retired.verifiedExecutions, 2);
  assert.equal(retired.failedOutcomes, 1);

  await addAgent("2");
  for (let n = 10; n < 15; n += 1) {
    const id = await addAction("2", n);
    await addProof("2", id, n, "receipt_verified");
  }
  const browse = await reputation.listAgentsWithHistory(50, 0);
  assert.deepEqual(
    browse.agents.map((row) => row.agentId),
    ["1", "2"],
  );
  assert.equal(browse.agents[0].verifiedExecutions <= browse.agents[1].verifiedExecutions, true);
  assert.equal(browse.agents[0].agentId, "1");
  assert.equal(browse.agents.find((row) => row.agentId === "9"), undefined);

  const third = await addAction("1", 3);
  const page = await reputation.listAgentActivity("1", undefined, 2, 0);
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 2);
  const rest = await reputation.listAgentActivity("1", undefined, 2, 2);
  assert.equal(rest.items.length, 1);
  const verifiedOnly = await reputation.listAgentActivity("1", "verified", 50, 0);
  assert.equal(verifiedOnly.items.every((item) => item.verified), true);
  assert.equal(verifiedOnly.items.some((item) => item.executionId === third), false);
  const unverified = await reputation.listAgentActivity("1", "unverified", 50, 0);
  assert.equal(unverified.items.length, 1);
  assert.equal(unverified.items[0].executionId, third);

  const failed = await reputation.listAgentOutcomes("1", "failed", 50, 0);
  assert.equal(failed.items.length, 1);
  assert.equal(failed.items[0].expected, "balance > 0");
  assert.equal(failed.items[0].observed, "balance = 0");
  const unknown = await reputation.listAgentOutcomes("1", "unverifiable", 50, 0);
  assert.equal(unknown.items.length, 1);
  assert.match(unknown.items[0].reason, /adapter/i);

  const timeline = await reputation.listAgentTimeline("1", 100);
  assert.equal(timeline.some((entry) => entry.label === "Agent created" && entry.category === "Identity"), true);
  assert.equal(timeline.some((entry) => entry.label === "Execution verified" && entry.category === "Proof"), true);
  assert.equal(timeline.some((entry) => entry.label === "Execution indexed" && entry.category === "Execution"), true);
  assert.equal(timeline.some((entry) => entry.label === "Outcome failed"), true);
  assert.equal(timeline.some((entry) => entry.label === "Outcome unverifiable"), true);
  assert.equal(timeline.some((entry) => /trusted|safe|best/i.test(entry.label)), false);

  const flags = await reputation.listHistoryFlags();
  const one = flags.find((row) => row.agentId === "1");
  const nine = flags.find((row) => row.agentId === "9");
  assert.equal(one.verifiedExecutions, 2);
  assert.equal(one.verifiedOutcomes, 1);
  assert.equal(nine.verifiedExecutions, 0);
  assert.equal(nine.verifiedOutcomes, 0);
} finally {
  await vite.close();
}

console.log("reputation tests ok");
