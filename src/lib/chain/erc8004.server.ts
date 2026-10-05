import { createPublicClient, createWalletClient, decodeEventLog, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENTTRACE_METADATA_KEY,
  OUTCOME_TAG,
  VALIDATION_TAG,
  agentTraceLinkValue,
  erc8004,
  erc8004AgentRegistry,
  identityRegistryAbi,
  reputationRegistryAbi,
  validationRegistryAbi,
  type Erc8004Status,
} from "@/lib/chain/erc8004";
import { cachedKv, recordKv } from "@/lib/chain/chain-cache.server";
import { configuredRegistry, getIndexedAgent, getPublicClient } from "@/lib/chain/indexer.server";
import { MONAD } from "@/lib/chain/network";
import { getExecutionProof, monadChain, verifierKey } from "@/lib/chain/proof.server";
import { getOutcomeByExecution } from "@/lib/chain/reputation.server";
import { monadTransport } from "@/lib/chain/rpc.server";

/**
 * AgentTrace as an ERC-8004 validator.
 *
 * - Link: an AgentTrace agent is linked to an ERC-8004 identity when the same wallet owns both and
 *   the identity's "agenttrace" metadata is abi.encode(chainId, AgentRegistry, agentId).
 * - Validation: the identity owner asks AgentTrace (the verifier address) to validate an execution
 *   with requestHash = proof hash. The verifier answers 100 only for a receipt-verified, anchored
 *   proof, with responseHash = the same proof hash and a link to the public proof.
 * - Reputation: the verifier posts protocol outcomes as feedback (100 verified, 0 failed). tag2 is
 *   the execution id, so a second post for the same execution is detected onchain.
 */

const LINKS = "erc8004Links";
const TXS = "erc8004Txs";

export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit && /^https:\/\//.test(explicit)) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "https://agenttrace-plum.vercel.app";
}

export function verifierAddress(): `0x${string}` | null {
  const key = verifierKey();
  return key ? privateKeyToAccount(key).address : null;
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** The ERC-8004 registration file served for an AgentTrace agent (ERC-8004 registration-v1). */
export async function registrationFile(agentId: string) {
  const agent = await getIndexedAgent(agentId);
  if (!agent) return null;
  const link = await getErc8004Link(agentId).catch(() => null);
  const base = appUrl();
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agent.name,
    description: agent.description || `AgentTrace agent ${agentId}.`,
    image: `${base}/favicon.svg`,
    services: [
      { name: "web", endpoint: `${base}/agents/${agentId}` },
      { name: "agenttrace", endpoint: `${base}/api/v1/agents/${agentId}`, version: "1" },
    ],
    x402Support: false,
    active: agent.active,
    registrations: link ? [{ agentId: Number(link.erc8004Id), agentRegistry: erc8004AgentRegistry }] : [],
    supportedTrust: ["validation", "reputation"],
    agenttrace: { chainId: MONAD.chainId, agentRegistry: configuredRegistry(), agentId: Number(agentId) },
  };
}

/** Check the two-way link onchain. Returns the ERC-8004 owner when it holds. */
async function checkLink(agentId: string, erc8004Id: string): Promise<{ erc8004Id: string; owner: string } | null> {
  const registry = configuredRegistry();
  const agent = await getIndexedAgent(agentId);
  if (!registry || !agent?.owner) return null;
  const client = getPublicClient();
  const owner = await client.readContract({ address: erc8004.identity, abi: identityRegistryAbi, functionName: "ownerOf", args: [BigInt(erc8004Id)] });
  if (!same(owner, agent.owner)) return null;
  const value = await client.readContract({
    address: erc8004.identity,
    abi: identityRegistryAbi,
    functionName: "getMetadata",
    args: [BigInt(erc8004Id), AGENTTRACE_METADATA_KEY],
  });
  if (value.toLowerCase() !== agentTraceLinkValue(registry, agentId).toLowerCase()) return null;
  return { erc8004Id, owner: owner.toLowerCase() };
}

export async function getErc8004Link(agentId: string): Promise<{ erc8004Id: string; owner: string } | null> {
  const id = (await cachedKv(LINKS))[agentId];
  if (!id) return null;
  return checkLink(agentId, id);
}

/** Link from the identity registration transaction the owner just sent from the app. */
export async function linkFromRegistration(agentId: string, txHash: Hex): Promise<{ erc8004Id: string; owner: string } | null> {
  const client = createPublicClient({ chain: monadChain(), transport: monadTransport(20_000) });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("The ERC-8004 registration transaction reverted.");
  for (const log of receipt.logs) {
    if (!same(log.address, erc8004.identity)) continue;
    try {
      const decoded = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Registered") continue;
      const id = decoded.args.agentId.toString();
      const link = await checkLink(agentId, id);
      if (!link) throw new Error("The ERC-8004 identity does not point back to this AgentTrace agent.");
      await recordKv(LINKS, agentId, id);
      await recordKv(TXS, `register:${agentId}`, txHash.toLowerCase());
      return link;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("The ERC-8004")) throw err;
    }
  }
  throw new Error("No ERC-8004 Registered event in that transaction.");
}

/** Link an existing ERC-8004 identity whose owner already set the agenttrace metadata. */
export async function linkExisting(agentId: string, erc8004Id: string) {
  const link = await checkLink(agentId, erc8004Id);
  if (!link) throw new Error("Not linked: the same wallet must own both, and the identity must carry the agenttrace metadata.");
  await recordKv(LINKS, agentId, erc8004Id);
  return link;
}

export async function erc8004Status(agentId: string): Promise<Erc8004Status> {
  const validator = verifierAddress();
  const link = await getErc8004Link(agentId).catch(() => null);
  const base: Erc8004Status = {
    registries: erc8004,
    agentRegistry: erc8004AgentRegistry,
    agentTraceRegistry: configuredRegistry(),
    validator,
    link,
    validation: null,
    outcomes: null,
  };
  if (!link || !validator) return base;
  const client = getPublicClient();
  const id = BigInt(link.erc8004Id);
  const [vCount, vAvg] = await client.readContract({ address: erc8004.validation, abi: validationRegistryAbi, functionName: "getSummary", args: [id, [validator], VALIDATION_TAG] });
  const [rCount, rValue, rDecimals] = await client.readContract({ address: erc8004.reputation, abi: reputationRegistryAbi, functionName: "getSummary", args: [id, [validator], OUTCOME_TAG, ""] }).catch(() => [0n, 0n, 0] as const);
  return {
    ...base,
    validation: { count: Number(vCount), average: Number(vAvg) },
    outcomes: { count: Number(rCount), average: Number(rCount) ? Number(rValue) / 10 ** Number(rDecimals) : null },
  };
}

type PublishResult = {
  linked: boolean;
  validation: { state: "not_requested" | "responded" | "sent" | "not_ready" | "wrong_validator"; txHash: string | null; response: number | null };
  feedback: { state: "none" | "posted" | "sent" | "not_ready"; txHash: string | null; value: number | null };
  reason: string;
};

/**
 * Post what AgentTrace verified for one execution to ERC-8004: the validation response (when the
 * owner requested it) and the outcome feedback (when the outcome is final). Idempotent: anything
 * already onchain is reported, not sent again.
 */
export async function publishExecution(executionId: string): Promise<PublishResult> {
  const out: PublishResult = {
    linked: false,
    validation: { state: "not_ready", txHash: null, response: null },
    feedback: { state: "not_ready", txHash: null, value: null },
    reason: "",
  };
  const proof = await getExecutionProof(executionId);
  if (!proof) return { ...out, reason: "No AgentAction is indexed for this execution." };
  const link = await getErc8004Link(proof.agentId).catch(() => null);
  if (!link) return { ...out, reason: "This agent is not linked to an ERC-8004 identity." };
  out.linked = true;
  const key = verifierKey();
  if (!key) return { ...out, reason: "The verifier key is not configured. Nothing was posted." };
  const account = privateKeyToAccount(key);
  const client = getPublicClient();
  const wallet = createWalletClient({ account, chain: monadChain(), transport: monadTransport(20_000) });
  const writer = createPublicClient({ chain: monadChain(), transport: monadTransport(20_000) });
  const txs = await cachedKv(TXS);
  const base = appUrl();
  const erc8004Id = BigInt(link.erc8004Id);

  // Validation response
  if (proof.verificationStatus === "receipt_verified" && proof.anchored && proof.proofHash) {
    const requestHash = proof.proofHash as Hex;
    const status = await client
      .readContract({ address: erc8004.validation, abi: validationRegistryAbi, functionName: "getValidationStatus", args: [requestHash] })
      .catch(() => null);
    if (!status) {
      out.validation.state = "not_requested";
    } else if (!same(status[0], account.address) || status[1] !== erc8004Id) {
      out.validation.state = "wrong_validator";
    } else if (status[3] !== `0x${"00".repeat(32)}`) {
      out.validation = { state: "responded", txHash: txs[`validation:${executionId}`] ?? null, response: Number(status[2]) };
    } else {
      const hash = await wallet.writeContract({
        address: erc8004.validation,
        abi: validationRegistryAbi,
        functionName: "validationResponse",
        args: [requestHash, 100, `${base}/proofs/${executionId}`, requestHash, VALIDATION_TAG],
      });
      const receipt = await writer.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The ERC-8004 validation response reverted.");
      await recordKv(TXS, `validation:${executionId}`, hash.toLowerCase());
      out.validation = { state: "sent", txHash: hash, response: 100 };
    }
  }

  // Outcome feedback
  const outcome = await getOutcomeByExecution(executionId).catch(() => null);
  if (outcome && (outcome.status === "verified" || outcome.status === "failed")) {
    const value = outcome.status === "verified" ? 100 : 0;
    const existing = await client
      .readContract({ address: erc8004.reputation, abi: reputationRegistryAbi, functionName: "readAllFeedback", args: [erc8004Id, [account.address], OUTCOME_TAG, executionId, false] })
      .catch(() => null);
    if (existing && existing[0].length > 0) {
      out.feedback = { state: "posted", txHash: txs[`feedback:${executionId}`] ?? null, value: Number(existing[2][0]) };
    } else {
      const feedbackHash = keccak256(toBytes(JSON.stringify({ executionId, status: outcome.status, observed: outcome.observed, evidence: outcome.evidence })));
      const hash = await wallet.writeContract({
        address: erc8004.reputation,
        abi: reputationRegistryAbi,
        functionName: "giveFeedback",
        args: [erc8004Id, BigInt(value), 0, OUTCOME_TAG, executionId, "", `${base}/outcomes/${executionId}`, feedbackHash],
      });
      const receipt = await writer.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The ERC-8004 feedback transaction reverted.");
      await recordKv(TXS, `feedback:${executionId}`, hash.toLowerCase());
      out.feedback = { state: "sent", txHash: hash, value };
    }
  } else {
    out.feedback.state = "none";
  }
  return out;
}

/** Transaction hashes AgentTrace recorded for an execution's ERC-8004 posts. */
export async function publishedTxs(executionId: string) {
  const txs = await cachedKv(TXS);
  return { validation: txs[`validation:${executionId}`] ?? null, feedback: txs[`feedback:${executionId}`] ?? null };
}
