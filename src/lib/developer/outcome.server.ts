import { decodeEventLog, keccak256, parseAbiItem, toBytes, type Hex } from "viem";
import { getSql } from "@/lib/db";
import { demoProtocolAbi } from "@/lib/chain/abi";
import { getPublicClient } from "@/lib/chain/indexer.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { apiError, apiJson } from "@/lib/developer/errors";
import { publishDeveloperEvent } from "@/lib/developer/webhooks.server";
import { configuredDemoProtocol } from "@/lib/chain/addresses.server";
import { cachedOutcomeRequests, recordOutcomeRequest } from "@/lib/chain/chain-cache.server";

const SIGNATURE = /^[A-Za-z_][A-Za-z0-9_]*\(([A-Za-z0-9]+)(,[A-Za-z0-9]+)*\)$/;
const OPERATORS = new Set([">=", "<=", ">", "<", "==", "!="]);

type EventExpectation = {
  type: "EVENT_EMITTED";
  event: string;
  eventSignature: string;
  conditions: Record<string, { operator: string; value: string }>;
};

type StateExpectation = {
  type: "VALUE_CHANGED" | "BALANCE_CHANGED" | "STATE_CHANGED";
  source: "DemoProtocol";
  field: "deposits" | "swapped";
  agentId: string;
  expectedValue: string;
};

type Expectation = EventExpectation | StateExpectation;

const STATE_TYPES = new Set(["VALUE_CHANGED", "BALANCE_CHANGED", "STATE_CHANGED"]);
const DEMO_EVENTS = [
  parseAbiItem("event Deposited(uint256 indexed agentId, uint256 amount)"),
  parseAbiItem("event Withdrawn(uint256 indexed agentId, uint256 amount)"),
  parseAbiItem("event Swapped(uint256 indexed agentId, uint256 amountIn, uint256 amountOut)"),
];

type ActionRow = {
  execution_id: string;
  agent_id: string;
  target: string;
  tx_hash: string;
};

export function parseExpectation(value: unknown): Expectation | { error: string } {
  if (!value || typeof value !== "object") return { error: "An expectation is required." };
  const raw = value as Record<string, unknown>;
  if (typeof raw.type === "string" && STATE_TYPES.has(raw.type)) {
    if (raw.source !== "DemoProtocol") {
      return { error: "Only the Demo Protocol state adapter is supported. Other sources are not verified." };
    }
    if (raw.field !== "deposits" && raw.field !== "swapped") {
      return { error: "Field must be deposits or swapped." };
    }
    if (typeof raw.agentId !== "string" || !/^[1-9]\d*$/.test(raw.agentId)) {
      return { error: "agentId is required." };
    }
    if (typeof raw.expectedValue !== "string" || !/^\d+$/.test(raw.expectedValue)) {
      return { error: "expectedValue must be a decimal string. The outcome is not guessed." };
    }
    return {
      type: raw.type as StateExpectation["type"],
      source: "DemoProtocol",
      field: raw.field,
      agentId: raw.agentId,
      expectedValue: raw.expectedValue,
    };
  }
  if (raw.type !== "EVENT_EMITTED") {
    return { error: "Only EVENT_EMITTED is supported. Other outcome types are rejected." };
  }
  if (typeof raw.event !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.event)) {
    return { error: "Event name is required." };
  }
  if (typeof raw.eventSignature !== "string" || !SIGNATURE.test(raw.eventSignature)) {
    return { error: "Event signature is required, for example Swapped(uint256,uint256). The name alone is not verified." };
  }
  if (!raw.eventSignature.startsWith(`${raw.event}(`)) {
    return { error: "The event name does not match the signature." };
  }
  const conditions: EventExpectation["conditions"] = {};
  if (raw.conditions != null) {
    if (typeof raw.conditions !== "object" || Array.isArray(raw.conditions)) return { error: "Conditions must be an object." };
    for (const [key, item] of Object.entries(raw.conditions as Record<string, unknown>)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { error: "Condition name is invalid." };
      if (!item || typeof item !== "object") return { error: "Each condition needs an operator and a value." };
      const condition = item as Record<string, unknown>;
      if (typeof condition.operator !== "string" || !OPERATORS.has(condition.operator)) {
        return { error: "Unsupported condition operator." };
      }
      if (typeof condition.value !== "string" || condition.value.length > 200) return { error: "Condition value must be a string." };
      conditions[key] = { operator: condition.operator, value: condition.value };
    }
  }
  return { type: "EVENT_EMITTED", event: raw.event, eventSignature: raw.eventSignature, conditions };
}

export async function readOutcomes(executionId: string): Promise<Response> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(executionId)) {
    return apiError(400, "INVALID_REQUEST", "Execution id must be a 32-byte hex value.");
  }
  const id = executionId.toLowerCase();
  const sql = await getSql();
  const actions = await sql<{ execution_id: string }>`
    select execution_id from firewall_actions
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}
  `;
  if (!actions.length) return apiError(404, "EXECUTION_NOT_FOUND", "No indexed execution has that id.");
  const rows = await sql<{
    outcome_id: string;
    status: string;
    expected: string;
    observed: string;
    evidence: string;
    reason: string;
    verified_at: string | null;
  }>`
    select outcome_id, status, expected, observed, evidence, reason, verified_at::text as verified_at
    from execution_outcomes
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}
    order by outcome_id asc
  `;
  return apiJson({
    executionId: id,
    outcomes: rows.map((row) => ({
      outcomeHash: row.outcome_id,
      status: row.status,
      expected: row.expected,
      observed: row.observed,
      evidence: row.evidence,
      reason: row.reason,
      verifiedAt: row.verified_at,
    })),
  });
}

export async function readOutcomeEvidence(executionId: string): Promise<Response> {
  const response = await readOutcomes(executionId);
  if (!response.ok) return response;
  const body = (await response.json()) as {
    executionId: string;
    outcomes: Array<{ outcomeHash: string; status: string; evidence: string; observed: string; reason: string }>;
  };
  return apiJson({
    executionId: body.executionId,
    evidence: body.outcomes.map((row) => ({
      outcomeHash: row.outcomeHash,
      status: row.status,
      evidence: row.evidence,
      observed: row.observed,
      reason: row.reason,
    })),
  });
}

/** Outcomes are not an onchain anchor. This refuses instead of inventing a transaction. */
export async function refuseOutcomeAnchor(executionId: string): Promise<Response> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(executionId)) {
    return apiError(400, "INVALID_REQUEST", "Execution id must be a 32-byte hex value.");
  }
  const listed = await readOutcomes(executionId);
  if (listed.status === 404) {
    return apiError(404, "EXECUTION_NOT_FOUND", "No indexed execution has that id. No anchor transaction was sent.");
  }
  return apiError(
    409,
    "CHAIN_WRITE_UNAVAILABLE",
    "Outcomes are not anchored onchain. Anchor the execution proof after receipt verification. No transaction was sent.",
  );
}

export async function verifyOutcome(
  executionId: string,
  body: unknown,
  opts: { replay?: boolean } = {},
): Promise<Response> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(executionId)) {
    return apiError(400, "INVALID_REQUEST", "Execution id must be a 32-byte hex value.");
  }
  const expectation = parseExpectation(body && typeof body === "object" ? (body as { expectation?: unknown }).expectation : undefined);
  if ("error" in expectation) {
    if (
      expectation.error.startsWith("Only EVENT_EMITTED") ||
      expectation.error.startsWith("Only the Demo Protocol")
    ) {
      return apiError(400, "OUTCOME_UNSUPPORTED", expectation.error);
    }
    return apiError(400, "INVALID_REQUEST", expectation.error);
  }
  const id = executionId.toLowerCase();
  const sql = await getSql();
  const actions = await sql<ActionRow>`
    select execution_id, agent_id, target, tx_hash from firewall_actions
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}
  `;
  const action = actions[0];
  if (!action) return apiError(404, "EXECUTION_NOT_FOUND", "No indexed execution has that id. Nothing was marked verified.");

  const result = await judge(action, expectation);
  const outcomeHash = keccak256(toBytes(stable({ executionId: id, expectation, status: result.status, observed: result.observed })));
  const inserted = await sql<{ outcome_id: string }>`
    insert into execution_outcomes (
      chain_id, outcome_id, execution_id, agent_id, status, expected, observed, evidence, reason, verified_at
    ) values (
      ${MONAD_TESTNET.chainId},
      ${outcomeHash},
      ${id},
      ${action.agent_id},
      ${result.status},
      ${JSON.stringify(expectation)},
      ${result.observed},
      ${result.evidence},
      ${result.reason},
      ${result.status === "verified" ? new Date().toISOString() : null}
    )
    on conflict (chain_id, outcome_id) do nothing
    returning outcome_id
  `;
  if (!opts.replay) {
    await recordOutcomeRequest({ executionId: id, expectation }).catch(() => undefined);
  }
  if (inserted.length && !opts.replay) {
    const event =
      result.status === "verified" ? "outcome.verified" : result.status === "failed" ? "outcome.failed" : "outcome.unverifiable";
    try {
      await publishDeveloperEvent(event, { executionId: id, agentId: action.agent_id, outcomeHash, status: result.status });
    } catch (err) {
      console.error("[agenttrace-webhook]", err);
    }
  }
  return apiJson({
    executionId: id,
    status: result.status,
    expected: JSON.stringify(expectation),
    observed: result.observed,
    evidence: result.evidence,
    reason: result.reason,
    outcomeHash,
  });
}

/**
 * Decode the matched log. A canonical signature such as `Deposited(uint256,uint256)` carries no
 * parameter names or `indexed` flags, so the Demo Protocol is decoded with its compiled ABI (named,
 * with the real indexed layout). Other targets try each indexed layout that fits the topic count and
 * name parameters `arg0`, `arg1`, … in signature order.
 */
function decodeExpectedLog(
  target: string,
  expectation: Extract<Expectation, { type: "EVENT_EMITTED" }>,
  log: { data: Hex; topics: Hex[] },
): Record<string, unknown> {
  const topics = log.topics as [Hex, ...Hex[]];
  const demo = configuredDemoProtocol();
  if (demo && target.toLowerCase() === demo) {
    const item = demoProtocolAbi.find((entry) => entry.type === "event" && entry.name === expectation.event);
    if (item) return decodeEventLog({ abi: [item], data: log.data, topics }).args as Record<string, unknown>;
  }
  const types = expectation.eventSignature.slice(expectation.eventSignature.indexOf("(") + 1, -1).split(",");
  const indexedCount = topics.length - 1;
  if (indexedCount < 0 || indexedCount > Math.min(3, types.length)) throw new Error("Topic count does not fit the signature.");
  const layouts: boolean[][] = [];
  const walk = (i: number, left: number, acc: boolean[]) => {
    if (i === types.length) {
      if (left === 0) layouts.push(acc);
      return;
    }
    if (left > 0) walk(i + 1, left - 1, [...acc, true]);
    walk(i + 1, left, [...acc, false]);
  };
  walk(0, indexedCount, []);
  for (const layout of layouts) {
    const params = types.map((type, i) => `${type}${layout[i] ? " indexed" : ""} arg${i}`).join(", ");
    try {
      const abi = [parseAbiItem(`event ${expectation.event}(${params})`)];
      return decodeEventLog({ abi, data: log.data, topics }).args as Record<string, unknown>;
    } catch {
      // try the next indexed layout
    }
  }
  throw new Error("No indexed layout decodes this log.");
}

async function judge(
  action: ActionRow,
  expectation: Expectation,
): Promise<{ status: "verified" | "failed" | "unverifiable"; observed: string; evidence: string; reason: string }> {
  if (expectation.type !== "EVENT_EMITTED") return judgeDemoState(action, expectation);
  const evidence = action.tx_hash;
  try {
    const receipt = await getPublicClient().getTransactionReceipt({ hash: action.tx_hash as Hex });
    const topic = keccak256(toBytes(expectation.eventSignature));
    const logs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === action.target.toLowerCase() && log.topics[0]?.toLowerCase() === topic.toLowerCase(),
    );
    if (!logs.length) {
      return {
        status: "failed",
        observed: "Event was not in the transaction receipt.",
        evidence,
        reason: "The expected event was not emitted by the execution target.",
      };
    }
    let decoded: Record<string, unknown> = {};
    try {
      decoded = decodeExpectedLog(action.target, expectation, logs[0]);
    } catch {
      return {
        status: "unverifiable",
        observed: "The log matched the topic but could not be decoded.",
        evidence,
        reason: "Unverifiable is not a failure and not a success.",
      };
    }
    const observed: Record<string, string> = {};
    for (const [key, value] of Object.entries(decoded)) {
      if (/^\d+$/.test(key)) continue;
      observed[key] = typeof value === "bigint" ? value.toString() : String(value);
    }
    for (const [key, condition] of Object.entries(expectation.conditions)) {
      if (!(key in observed)) {
        return {
          status: "unverifiable",
          observed: JSON.stringify(observed),
          evidence,
          reason: `The decoded event has no ${key} argument.`,
        };
      }
      const passed = compare(observed[key], condition.operator, condition.value);
      if (passed == null) {
        return {
          status: "unverifiable",
          observed: JSON.stringify(observed),
          evidence,
          reason: "The condition could not be compared.",
        };
      }
      if (!passed) {
        return {
          status: "failed",
          observed: JSON.stringify(observed),
          evidence,
          reason: "A recorded condition was not met. This is not a judgment of the agent.",
        };
      }
    }
    return {
      status: "verified",
      observed: JSON.stringify(observed),
      evidence,
      reason: "The event was in the receipt and every condition matched.",
    };
  } catch {
    return {
      status: "unverifiable",
      observed: "Transaction receipt is not available.",
      evidence,
      reason: "The receipt could not be read. The outcome is not verified and not failed.",
    };
  }
}

async function judgeDemoState(
  action: ActionRow,
  expectation: StateExpectation,
): Promise<{ status: "verified" | "failed" | "unverifiable"; observed: string; evidence: string; reason: string }> {
  const evidence = action.tx_hash;
  const demo = configuredDemoProtocol();
  if (!demo) {
    return {
      status: "unverifiable",
      observed: "Demo Protocol is not deployed.",
      evidence,
      reason: "No state was read. The outcome is not verified.",
    };
  }
  if (action.target.toLowerCase() !== demo) {
    return {
      status: "unverifiable",
      observed: "Execution target is not Demo Protocol.",
      evidence,
      reason: "This adapter only reads Demo Protocol. The outcome is not verified.",
    };
  }
  if (expectation.agentId !== action.agent_id) {
    return {
      status: "failed",
      observed: action.agent_id,
      evidence,
      reason: "The expectation names a different agent than the execution.",
    };
  }
  try {
    const client = getPublicClient();
    const receipt = await client.getTransactionReceipt({ hash: action.tx_hash as Hex });
    const touched = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== demo) return false;
      for (const abiItem of DEMO_EVENTS) {
        try {
          const parsed = decodeEventLog({ abi: [abiItem], data: log.data, topics: log.topics });
          const args = parsed.args as { agentId?: bigint };
          if (args.agentId?.toString() === expectation.agentId) return true;
        } catch {
          // This log is a different event.
        }
      }
      return false;
    });
    const current = await client.readContract({
      address: demo,
      abi: demoProtocolAbi,
      functionName: expectation.field,
      args: [BigInt(expectation.agentId)],
    });
    const observed = current.toString();
    if (!touched) {
      return {
        status: "failed",
        observed,
        evidence,
        reason: "This transaction did not emit a Demo Protocol balance event for that agent.",
      };
    }
    if (observed !== expectation.expectedValue) {
      return {
        status: "failed",
        observed,
        evidence,
        reason: "The onchain value does not match the expected value.",
      };
    }
    return {
      status: "verified",
      observed,
      evidence,
      reason: "Demo Protocol emitted a balance event in this transaction and the current value matches.",
    };
  } catch {
    return {
      status: "unverifiable",
      observed: "Demo Protocol state could not be read.",
      evidence,
      reason: "The receipt or the contract state could not be read. The outcome is not verified.",
    };
  }
}

function compare(observed: string, operator: string, expected: string): boolean | null {
  if (operator === "==") return observed === expected;
  if (operator === "!=") return observed !== expected;
  if (!/^\d+$/.test(observed) || !/^\d+$/.test(expected)) return null;
  const left = BigInt(observed);
  const right = BigInt(expected);
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  return null;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

/** Outcome for the demo deposit. The expectation is fixed here. Callers cannot supply a proof hash. */
export async function verifyDemoDepositOutcome(executionId: string): Promise<Response> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(executionId)) {
    return apiError(400, "INVALID_REQUEST", "Execution id must be a 32-byte hex value.");
  }
  const demo = configuredDemoProtocol();
  if (!demo) {
    return apiError(409, "CHAIN_UNAVAILABLE", "Demo Protocol is not deployed. No outcome was recorded.");
  }
  const id = executionId.toLowerCase();
  const sql = await getSql();
  const actions = await sql<ActionRow>`
    select execution_id, agent_id, target, tx_hash from firewall_actions
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}
  `;
  const action = actions[0];
  if (!action) return apiError(404, "EXECUTION_NOT_FOUND", "No indexed execution has that id. Nothing was marked verified.");
  if (action.target.toLowerCase() !== demo) {
    return apiError(400, "OUTCOME_UNSUPPORTED", "This execution did not call the Demo Protocol. No outcome was recorded.");
  }
  return verifyOutcome(executionId, {
    expectation: {
      type: "EVENT_EMITTED",
      event: "Deposited",
      eventSignature: "Deposited(uint256,uint256)",
      conditions: {
        agentId: { operator: "==", value: action.agent_id },
        amount: { operator: "==", value: "100" },
      },
    },
  });
}

/**
 * On a fresh serverless instance, re-run outcome checks that were requested elsewhere. Only the
 * request (execution id and expectation) comes from the cache; the verdict is recomputed from
 * Monad here, and no webhook is sent again.
 */
export async function replayOutcomeRequests(limit = 6): Promise<void> {
  const slot = globalThis as typeof globalThis & { __agenttraceOutcomeReplay?: Set<string> };
  const done = (slot.__agenttraceOutcomeReplay ??= new Set());
  const requests = await cachedOutcomeRequests();
  if (!requests.length) return;
  const sql = await getSql();
  let ran = 0;
  for (const request of requests) {
    if (ran >= limit) break;
    const key = `${request.executionId}:${JSON.stringify(request.expectation)}`;
    if (done.has(key)) continue;
    const action = await sql<{ execution_id: string }>`
      select execution_id from firewall_actions
      where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${request.executionId}
    `;
    if (!action.length) continue; // not indexed here yet; try again on a later request
    done.add(key);
    const existing = await sql<{ outcome_id: string }>`
      select outcome_id from execution_outcomes
      where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${request.executionId}
    `;
    if (existing.length) continue;
    ran += 1;
    await verifyOutcome(request.executionId, { expectation: request.expectation }, { replay: true }).catch(
      () => undefined,
    );
  }
}
