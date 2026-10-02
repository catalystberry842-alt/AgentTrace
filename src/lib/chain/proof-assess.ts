import { decodeEventLog, decodeFunctionData, keccak256, type Hex } from "viem";
import { agentFirewallAbi } from "@/lib/chain/abi";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { computeProofHash } from "@/lib/chain/proof-hash";

export const VERIFICATION_METHOD = "monad-receipt-v1";

export type ProofCheckName =
  | "transactionExists"
  | "receiptExists"
  | "transactionSucceeded"
  | "actionEventExists"
  | "agentExists"
  | "agentMatches"
  | "firewallMatches"
  | "executorAuthorized"
  | "targetMatches"
  | "selectorMatches"
  | "executionIdMatches"
  | "blockMatches"
  | "valueMatches"
  | "calldataHashMatches";

export type AssessedCheck = {
  name: ProofCheckName;
  passed: boolean;
  details: string;
};

export type AssessedAction = {
  executionId: string;
  agentId: string;
  firewallId: string;
  executor: string;
  target: string;
  selector: string;
  value: string;
  calldataHash: string;
  txHash: string;
  blockNumber: number;
};

export type AssessedLog = {
  address: string;
  topics: Hex[];
  data: Hex;
};

export type AssessedEvidence = {
  action: AssessedAction;
  agentExists: boolean;
  firewallAgentId: string | null;
  firewallContract: string | null;
  tx: { hash: string; from: string; to: string | null; input: Hex; value: bigint } | null;
  receipt: { status: "success" | "reverted"; transactionHash: string; blockNumber: number; logs: AssessedLog[] } | null;
};

export type Assessment = {
  status: "receipt_verified" | "unverifiable";
  checks: AssessedCheck[];
  proofHash: `0x${string}` | null;
};

const SKIPPED = "Not evaluated.";

function check(name: ProofCheckName, passed: boolean, details: string): AssessedCheck {
  return { name, passed, details: passed ? "" : details };
}

function hexEq(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function asHex32(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

function asAddr(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

function asSelector(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{8}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

export function assessExecution(input: AssessedEvidence): Assessment {
  const action = input.action;
  const tx = input.tx;
  const receipt = input.receipt;
  const transactionExists = tx !== null;
  const receiptExists = receipt !== null;
  const succeeded = receipt?.status === "success";

  let event: {
    agentId: string;
    firewallId: string;
    executor: `0x${string}`;
    target: `0x${string}`;
    selector: `0x${string}`;
    value: string;
    executionId: `0x${string}`;
    calldataHash: `0x${string}`;
  } | null = null;
  let eventOnFirewall = false;
  let otherExecution = false;

  if (receipt && input.firewallContract) {
    for (const log of receipt.logs) {
      if (!hexEq(log.address, input.firewallContract)) continue;
      if (log.topics.length === 0) continue;
      try {
        const decoded = decodeEventLog({
          abi: agentFirewallAbi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName !== "AgentAction") continue;
        const args = decoded.args;
        const executionId = asHex32(String(args.executionId));
        const executor = asAddr(String(args.executor));
        const target = asAddr(String(args.target));
        const selector = asSelector(String(args.functionSelector));
        const calldataHash = asHex32(String(args.calldataHash));
        if (!executionId || !executor || !target || !selector || !calldataHash) continue;
        if (!hexEq(executionId, action.executionId)) {
          otherExecution = true;
          continue;
        }
        eventOnFirewall = true;
        event = {
          agentId: String(args.agentId),
          firewallId: String(args.firewallId),
          executor,
          target,
          selector,
          value: String(args.value),
          executionId,
          calldataHash,
        };
        break;
      } catch {
        continue;
      }
    }
  }

  const actionEventExists = event !== null && eventOnFirewall;
  const agentMatches = actionEventExists && event?.agentId === action.agentId;
  const firewallMatches =
    actionEventExists &&
    event?.firewallId === action.firewallId &&
    input.firewallAgentId !== null &&
    input.firewallAgentId === action.agentId;
  const executorAuthorized =
    actionEventExists &&
    tx !== null &&
    hexEq(tx.from, action.executor) &&
    hexEq(event?.executor, action.executor) &&
    hexEq(tx.to, input.firewallContract);
  const targetMatches = actionEventExists && hexEq(event?.target, action.target);
  const selectorMatches = actionEventExists && hexEq(event?.selector, action.selector);
  const executionIdMatches = actionEventExists && hexEq(event?.executionId, action.executionId);
  const blockMatches = receipt !== null && receipt.blockNumber === action.blockNumber && hexEq(receipt.transactionHash, action.txHash) && (tx === null || hexEq(tx.hash, action.txHash));

  let valueOk = false;
  let valueDetail = "Not evaluated because the AgentAction event was not found.";
  if (actionEventExists && event && tx) {
    let parsed: bigint | null = null;
    try {
      parsed = BigInt(action.value);
    } catch {
      parsed = null;
    }
    const eventOk = parsed !== null && event.value === parsed.toString();
    const txOk = parsed !== null && tx.value === parsed;
    valueOk = eventOk && txOk;
    if (!eventOk) valueDetail = "Event value does not match the indexed execution.";
    else if (!txOk) valueDetail = "Transaction value does not match the indexed execution.";
    else valueDetail = "";
  } else if (actionEventExists && !tx) {
    valueDetail = "Not evaluated because the transaction was not found.";
  }

  let calldataOk = false;
  let calldataDetail = "Transaction input is not an AgentFirewall execute call.";
  if (tx && actionEventExists && event) {
    try {
      const decoded = decodeFunctionData({ abi: agentFirewallAbi, data: tx.input });
      if (decoded.functionName === "execute") {
        const [, , , data] = decoded.args;
        const hashed = keccak256(data).toLowerCase();
        calldataOk = hashed === event.calldataHash && hashed === action.calldataHash.toLowerCase();
        calldataDetail = calldataOk ? "" : "Calldata hash does not match the execute input.";
      }
    } catch {
      calldataDetail = "Transaction input could not be decoded.";
    }
  } else if (!transactionExists) {
    calldataDetail = "Not evaluated because the transaction was not found.";
  } else if (!actionEventExists) {
    calldataDetail = "Not evaluated because the AgentAction event was not found.";
  }

  const missingFirewall = !input.firewallContract;
  const checks: AssessedCheck[] = [
    check("transactionExists", transactionExists, "No transaction with the indexed hash was found."),
    check("receiptExists", receiptExists, transactionExists ? "The transaction has no receipt yet." : SKIPPED),
    check(
      "transactionSucceeded",
      succeeded,
      receipt ? "The transaction reverted." : "Not evaluated because the receipt was not found.",
    ),
    check(
      "actionEventExists",
      actionEventExists && !missingFirewall,
      missingFirewall
        ? "Agent Firewall address is not configured, so the event cannot be tied to the contract."
        : "The receipt has no AgentAction for this execution from the firewall contract.",
    ),
    check("agentExists", input.agentExists, "No indexed agent exists for this id."),
    check("agentMatches", agentMatches, actionEventExists ? "Event agent id does not match the indexed execution." : SKIPPED),
    check(
      "firewallMatches",
      firewallMatches,
      actionEventExists
        ? "Firewall id does not match this agent."
        : SKIPPED,
    ),
    check(
      "executorAuthorized",
      executorAuthorized,
      actionEventExists ? "The transaction sender is not the executor recorded in AgentAction." : SKIPPED,
    ),
    check("targetMatches", targetMatches, actionEventExists ? "Event target does not match the indexed execution." : SKIPPED),
    check(
      "selectorMatches",
      selectorMatches,
      actionEventExists ? "Event selector does not match the indexed execution." : SKIPPED,
    ),
    check(
      "executionIdMatches",
      executionIdMatches,
      otherExecution
        ? "The receipt's AgentAction uses a different execution id."
        : actionEventExists
          ? "Event execution id does not match the indexed execution."
          : "The receipt has no AgentAction for this execution from the firewall contract.",
    ),
    check(
      "blockMatches",
      blockMatches,
      receipt ? "Receipt block or transaction hash does not match the indexed execution." : SKIPPED,
    ),
    check("valueMatches", valueOk, valueDetail),
    check("calldataHashMatches", calldataOk, calldataDetail),
  ];

  const passed = checks.every((item) => item.passed);
  if (!passed || !event || !tx) {
    return { status: "unverifiable", checks, proofHash: null };
  }

  const proofHash = computeProofHash({
    chainId: BigInt(MONAD_TESTNET.chainId),
    agentId: BigInt(action.agentId),
    firewallId: BigInt(action.firewallId),
    executionId: event.executionId,
    executor: event.executor,
    transactionHash: tx.hash.toLowerCase() as `0x${string}`,
    blockNumber: BigInt(receipt?.blockNumber ?? action.blockNumber),
    target: event.target,
    functionSelector: event.selector,
    value: BigInt(event.value),
    calldataHash: event.calldataHash,
  });
  return { status: "receipt_verified", checks, proofHash };
}
