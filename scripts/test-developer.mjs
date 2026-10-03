import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer as createVite } from "vite";

const root = join(import.meta.dirname, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts|md)$/.test(name)) out.push(path);
  }
  return out;
}

const sdkText = walk(join(root, "sdk")).map((file) => readFileSync(file, "utf8")).join("\n");
assert.equal(sdkText.includes("executeDirectly"), false);
assert.equal(/0x[a-fA-F0-9]{64}/.test(sdkText), false);
const docs = readFileSync(join(root, "src/routes/developers/docs.tsx"), "utf8");
assert.equal(docs.includes("POST /api/v1/agents"), true);
assert.equal(docs.includes("REGISTRY_NOT_DEPLOYED"), true);
assert.equal(/0x[a-fA-F0-9]{64}/.test(docs), false);
assert.equal(readFileSync(join(root, "src/routes/developers/explorer.tsx"), "utf8").includes("apiKey"), false);
assert.equal(readFileSync(join(root, "src/routes/developers/api-keys.tsx"), "utf8").includes("localStorage"), false);

const vite = await createVite({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const received = [];
let server;

try {
  // These checks cover the "not deployed" paths with a local EVM. The committed record now holds
  // the live Monad testnet deployment, so blank it in this process only.
  const { deployment: record } = await vite.ssrLoadModule("/src/lib/chain/deployment.ts");
  for (const key of Object.keys(record)) if (key !== "chainId") record[key] = null;
  const keys = await vite.ssrLoadModule("/src/lib/developer/keys.server.ts");
  const v1 = await vite.ssrLoadModule("/src/lib/developer/v1.server.ts");
  const guard = await vite.ssrLoadModule("/src/lib/developer/guard.server.ts");
  const rate = await vite.ssrLoadModule("/src/lib/developer/rate-limit.server.ts");
  const hooks = await vite.ssrLoadModule("/src/lib/developer/webhooks.server.ts");
  const policy = await vite.ssrLoadModule("/src/lib/developer/policy.ts");
  const outcomes = await vite.ssrLoadModule("/src/lib/developer/outcome.server.ts");
  const db = await vite.ssrLoadModule("/src/lib/db.ts");
  const sdk = await vite.ssrLoadModule("/sdk/src/index.ts");
  const sql = await db.getSql();

  const limited = await rate.consumeRate("test-subject", 2);
  assert.equal(limited.allowed, true);
  assert.equal((await rate.consumeRate("test-subject", 2)).allowed, true);
  const blocked = await rate.consumeRate("test-subject", 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);

  const paused = policy.assessFirewallCall(firewall({ paused: true, status: "paused" }), call());
  assert.equal(paused.ok, false);
  assert.equal(paused.code, "FIREWALL_PAUSED");
  const missingTarget = policy.assessFirewallCall(firewall({}), call());
  assert.equal(missingTarget.code, "TARGET_NOT_ALLOWED");
  const over = policy.assessFirewallCall(
    firewall({
      allowValueTransfer: true,
      maxValuePerTransaction: "1",
      maxValuePerPeriod: "1",
      allowedTargets: [{ target: "0x1111111111111111111111111111111111111111", name: "demo", active: true }],
      allowedFunctions: [{ target: "0x1111111111111111111111111111111111111111", selector: "0xa9059cbb", active: true }],
    }),
    { ...call(), value: "2" },
  );
  assert.equal(over.code, "VALUE_LIMIT_EXCEEDED");

  assert.throws(() => new sdk.AgentTrace({ apiKey: "at_test_x", network: "monad-mainnet", baseUrl: "http://127.0.0.1" }), (err) => err.code === "MAINNET_UNAVAILABLE");

  const created = await keys.createApiKey("user-dev", "ci", "development");
  assert.ok(created.token.startsWith("at_test_"));
  const listed = await keys.listApiKeys("user-dev");
  assert.equal(JSON.stringify(listed).includes(created.token), false);
  const resolved = await keys.resolveApiKey(created.token);
  assert.equal(resolved.keyId, created.record.id);

  server = createServer(async (req, res) => {
    if (req.url === "/hook") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({ body: Buffer.concat(chunks).toString("utf8"), signature: req.headers["x-agenttrace-signature"] });
      res.writeHead(204);
      res.end();
      return;
    }
    const response = await dispatch(req, v1, guard, outcomes);
    const text = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const anon = await fetch(`${baseUrl}/api/v1/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(anon.status, 401);
  const anonBody = await anon.json();
  assert.equal(anonBody.error.code, "UNAUTHORIZED");

  const queryKey = await fetch(`${baseUrl}/api/v1/agents/1?api_key=${created.token}`);
  assert.equal(queryKey.status, 400);

  const bad = await fetch(`${baseUrl}/api/v1/agents/1`, { headers: { authorization: "Bearer at_test_not-a-key" } });
  assert.equal(bad.status, 401);

  const client = new sdk.AgentTrace({ apiKey: created.token, network: "monad-testnet", baseUrl });
  const agent = await client.agents.create({ name: "Research Agent", description: "AI research agent", capabilities: ["Research", "Data"] });
  assert.equal(agent.status, "failed");
  assert.equal(agent.agentId, null);
  assert.equal(agent.transactionHash, null);
  assert.equal(agent.error.code, "REGISTRY_NOT_DEPLOYED");

  const firewallWrite = await client.firewalls.create({
    agentId: "1",
    executor: "0x2222222222222222222222222222222222222222",
    policy: { allowValueTransfer: false, maxValuePerTransaction: "0", maxValuePerPeriod: "0", periodDuration: "3600" },
  });
  assert.equal(firewallWrite.status, "failed");
  assert.equal(firewallWrite.firewallId, null);
  assert.equal(firewallWrite.transactionHash, null);
  assert.equal(firewallWrite.error.code, "FIREWALL_NOT_DEPLOYED");

  const execution = await client.firewalls.execute({
    firewallId: "1",
    target: "0x1111111111111111111111111111111111111111",
    value: "0",
    data: "0xa9059cbb",
  });
  assert.equal(execution.status, "failed");
  assert.equal(execution.executionId, null);
  assert.equal(execution.transactionHash, null);
  assert.equal(execution.error.code, "FIREWALL_NOT_FOUND");

  await assert.rejects(() => client.agents.get("1"), (err) => err.code === "AGENT_NOT_FOUND");
  const executionId = `0x${"ab".repeat(32)}`;
  await assert.rejects(() => client.proofs.verify(executionId), (err) => err.code === "PROOF_NOT_FOUND");
  await assert.rejects(
    () => client.outcomes.verify({ executionId, expectation: { type: "BALANCE_CHANGED", event: "Swapped", eventSignature: "Swapped(uint256)" } }),
    (err) => err.code === "OUTCOME_UNSUPPORTED" || err.code === "EXECUTION_NOT_FOUND" || err.code === "INVALID_REQUEST",
  );

  await sql`
    insert into indexed_firewalls (
      chain_id, firewall_id, agent_id, owner, executor, active, paused, allow_value_transfer,
      max_value_per_tx, max_value_per_period, period_duration
    ) values (10143, '7', '1', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333', true, true, false, '0', '0', '3600')
  `;
  const pausedCall = await client.firewalls.execute({
    firewallId: "7",
    target: "0x1111111111111111111111111111111111111111",
    value: "0",
    data: "0xa9059cbb",
  });
  assert.equal(pausedCall.error.code, "FIREWALL_PAUSED");
  assert.equal(pausedCall.transactionHash, null);

  await sql`
    insert into firewall_actions (
      chain_id, execution_id, firewall_id, agent_id, executor, target, selector, value,
      execution_nonce, calldata_hash, tx_hash, log_index, block_number
    ) values (
      10143, ${executionId}, '7', '1', '0x3333333333333333333333333333333333333333',
      '0x1111111111111111111111111111111111111111', '0xa9059cbb', '0', '0', ${`0x${"11".repeat(32)}`},
      ${`0x${"22".repeat(32)}`}, 0, 1
    )
  `;
  const outcome = await client.outcomes.verify({
    executionId,
    expectation: { type: "EVENT_EMITTED", event: "Swapped", eventSignature: "Swapped(uint256,uint256)", conditions: { amountOut: { operator: ">=", value: "100" } } },
  });
  assert.notEqual(outcome.status, "verified");
  assert.equal(outcome.status, "unverifiable");
  assert.ok(outcome.outcomeHash.startsWith("0x"));

  const hook = await hooks.createWebhook("user-dev", `${baseUrl}/hook`, ["proof.verified"]);
  assert.equal(JSON.stringify(await hooks.listWebhooks("user-dev")).includes(hook.secret), false);
  await hooks.publishDeveloperEvent("proof.verified", { executionId, agentId: "1", proofHash: outcome.outcomeHash });
  assert.equal(received.length, 1);
  assert.equal(sdk.verifySignature(received[0].body, received[0].signature, hook.secret), true);
  assert.equal(sdk.verifySignature(received[0].body, received[0].signature, "whsec_wrong"), false);
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.type, "proof.verified");
  assert.equal(payload.data.executionId, executionId);

  assert.equal(await keys.revokeApiKey("user-dev", created.record.id), true);
  const revoked = await fetch(`${baseUrl}/api/v1/agents/1`, { headers: { authorization: `Bearer ${created.token}` } });
  assert.equal(revoked.status, 401);
  const revokedBody = await revoked.json();
  assert.equal(revokedBody.error.code, "UNAUTHORIZED");

  console.log("developer tests ok");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await vite.close();
}

function firewall(overrides) {
  return {
    id: "1",
    agentId: "1",
    agentName: "",
    owner: "0x2222222222222222222222222222222222222222",
    executor: "0x3333333333333333333333333333333333333333",
    active: true,
    paused: false,
    status: "active",
    createdAt: null,
    executionNonce: "0",
    allowValueTransfer: false,
    maxValuePerTransaction: "0",
    maxValuePerPeriod: "0",
    spentInPeriod: "0",
    periodStartUnix: "0",
    periodDuration: "3600",
    creationTxHash: null,
    allowedTargets: [],
    allowedFunctions: [],
    ...overrides,
  };
}

function call() {
  return { target: "0x1111111111111111111111111111111111111111", value: "0", data: "0xa9059cbb" };
}

async function dispatch(req, v1, guard, outcomes) {
  const url = new URL(req.url, "http://127.0.0.1");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === "host" || key === "content-length" || value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  const request = new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : raw,
  });
  const parts = url.pathname.split("/").filter(Boolean);
  const run = (mode, handler) => guard.withApi(request, mode, handler);
  if (req.method === "POST" && url.pathname === "/api/v1/agents") return run("required", () => v1.postAgent(request));
  if (req.method === "GET" && parts[0] === "api" && parts[1] === "v1" && parts[2] === "agents" && parts[3]) {
    return run("optional", () => v1.getAgent(parts[3]));
  }
  if (req.method === "POST" && url.pathname === "/api/v1/firewalls") return run("required", () => v1.postFirewall(request));
  if (req.method === "GET" && parts[2] === "firewalls" && parts[3] && !parts[4]) return run("optional", () => v1.getFirewall(parts[3]));
  if (req.method === "POST" && parts[2] === "firewalls" && parts[4] === "execute") return run("required", () => v1.postExecute(parts[3], request));
  if (req.method === "POST" && parts[2] === "proofs" && parts[4] === "verify") return run("required", () => v1.postProofVerify(parts[3]));
  if (req.method === "POST" && parts[2] === "outcomes" && parts[4] === "verify") {
    return run("required", async () => outcomes.verifyOutcome(parts[3], JSON.parse(raw.toString("utf8") || "{}")));
  }
  return new Response(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "Not routed in the test server." } }), { status: 404 });
}
