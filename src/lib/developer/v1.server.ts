import { getSql } from "@/lib/db";
import { CAPABILITIES } from "@/lib/agents/types";
import { parseCreateInput } from "@/lib/agents/validate";
import { parseFirewallDraft } from "@/lib/agents/firewall-input";
import {
  confirmRegistrationReceipt,
  configuredRegistry,
  getIndexedAgent,
  syncRegistrySafe,
} from "@/lib/chain/indexer.server";
import {
  configuredFirewall,
  getIndexedFirewall,
  ingestFirewallReceipt,
  syncFirewallSafe,
} from "@/lib/chain/firewall.server";
import { getExecutionProof, verifyIndexedExecution } from "@/lib/chain/proof.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { apiError, apiJson } from "@/lib/developer/errors";
import { assessFirewallCall } from "@/lib/developer/policy";
import type { ApiContext } from "@/lib/developer/guard.server";
import { createWebhook, disableWebhook, listWebhooks, parseWebhookEvents, parseWebhookUrl } from "@/lib/developer/webhooks.server";

const HASH = /^0x[a-fA-F0-9]{64}$/;

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (text.length > 20_000) return { ok: false, response: apiError(400, "INVALID_REQUEST", "The request body is too large.") };
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: apiError(400, "INVALID_REQUEST", "The request body must be JSON.") };
  }
}

function normalizeCapabilities(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.capabilities)) return value;
  const capabilities = raw.capabilities.map((item: unknown) => {
    if (typeof item !== "string") return item;
    const match = CAPABILITIES.find((name) => name.toLowerCase() === item.toLowerCase());
    return match ?? item;
  });
  return { ...raw, capabilities };
}

export async function getAgent(agentId: string): Promise<Response> {
  if (!/^[1-9]\d*$/.test(agentId)) return apiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  await syncRegistrySafe();
  const agent = await getIndexedAgent(agentId);
  if (!agent) return apiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  return apiJson({
    agentId: agent.agentId,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
    owner: agent.owner,
    active: agent.active,
    metadataURI: agent.metadataURI,
    registeredAt: agent.registeredAt,
    network: "monad-testnet",
    chainId: MONAD_TESTNET.chainId,
  });
}

export async function postAgent(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const parsed = parseCreateInput(normalizeCapabilities(body.value));
  if (!parsed.ok) return apiError(400, "INVALID_REQUEST", parsed.error);
  if (!configuredRegistry()) {
    return apiJson(
      {
        agentId: null,
        transactionHash: null,
        status: "failed",
        error: {
          code: "REGISTRY_NOT_DEPLOYED",
          message: "The registry contract is not deployed. No transaction was sent and no agent id was assigned.",
        },
      },
      409,
    );
  }
  const raw = body.value as { transactionHash?: unknown };
  if (typeof raw.transactionHash !== "string" || !HASH.test(raw.transactionHash)) {
    return apiJson(
      {
        agentId: null,
        transactionHash: null,
        status: "failed",
        error: {
          code: "CHAIN_WRITE_UNAVAILABLE",
          message: "Sign registerAgent from the owner and submit that transaction hash. The API does not send a registry transaction.",
        },
      },
      409,
    );
  }
  try {
    const sql = await getSql();
    const receipt = await confirmRegistrationReceipt(sql, raw.transactionHash.toLowerCase() as `0x${string}`);
    if (receipt.state === "pending") {
      return apiJson(
        {
          agentId: null,
          transactionHash: raw.transactionHash.toLowerCase(),
          status: "pending",
          error: { code: "CHAIN_UNAVAILABLE", message: "The transaction receipt is not available yet. The agent is not confirmed." },
        },
        202,
      );
    }
    if (receipt.state === "failed") {
      return apiJson(
        {
          agentId: null,
          transactionHash: raw.transactionHash.toLowerCase(),
          status: "failed",
          error: { code: "EXECUTION_FAILED", message: receipt.error },
        },
        409,
      );
    }
    return apiJson({
      agentId: receipt.agentId,
      transactionHash: raw.transactionHash.toLowerCase(),
      status: "confirmed",
    });
  } catch {
    return apiError(503, "CHAIN_UNAVAILABLE", `${MONAD_TESTNET.label} could not be read. Nothing was confirmed.`);
  }
}

export async function patchAgent(agentId: string): Promise<Response> {
  if (!/^[1-9]\d*$/.test(agentId)) return apiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  const agent = await getIndexedAgent(agentId);
  if (!agent) return apiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  return apiJson(
    {
      agentId: agent.agentId,
      transactionHash: null,
      status: "failed",
      error: {
        code: "CHAIN_WRITE_UNAVAILABLE",
        message: "Agent updates are onchain transactions. No update was sent and indexed fields were not changed.",
      },
    },
    409,
  );
}

export async function getFirewall(firewallId: string): Promise<Response> {
  if (!/^[1-9]\d*$/.test(firewallId)) return apiError(404, "FIREWALL_NOT_FOUND", "Firewall not found.");
  await syncFirewallSafe();
  const firewall = await getIndexedFirewall(firewallId);
  if (!firewall) return apiError(404, "FIREWALL_NOT_FOUND", "Firewall not found.");
  return apiJson({
    firewallId: firewall.id,
    agentId: firewall.agentId,
    owner: firewall.owner,
    executor: firewall.executor,
    status: firewall.status,
    paused: firewall.paused,
    active: firewall.active,
    allowValueTransfer: firewall.allowValueTransfer,
    maxValuePerTransaction: firewall.maxValuePerTransaction,
    maxValuePerPeriod: firewall.maxValuePerPeriod,
    periodDuration: firewall.periodDuration,
    allowedTargets: firewall.allowedTargets,
    allowedFunctions: firewall.allowedFunctions,
    network: "monad-testnet",
    chainId: MONAD_TESTNET.chainId,
  });
}

export async function postFirewall(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const raw = body.value as Record<string, unknown>;
  const policy = raw.policy && typeof raw.policy === "object" ? (raw.policy as Record<string, unknown>) : {};
  const parsed = parseFirewallDraft({
    agentId: raw.agentId,
    executor: raw.executor,
    allowValueTransfer: policy.allowValueTransfer,
    maxValuePerTransaction: policy.maxValuePerTransaction,
    maxValuePerPeriod: policy.maxValuePerPeriod,
    periodDuration: policy.periodDuration,
  });
  if (!parsed.ok) return apiError(400, "INVALID_REQUEST", parsed.error);
  if (!configuredFirewall()) {
    return apiJson(
      {
        firewallId: null,
        transactionHash: null,
        status: "failed",
        error: {
          code: "FIREWALL_NOT_DEPLOYED",
          message: "The firewall contract is not deployed. No transaction was sent and no firewall id was assigned.",
        },
      },
      409,
    );
  }
  if (typeof raw.transactionHash !== "string" || !HASH.test(raw.transactionHash)) {
    return apiJson(
      {
        firewallId: null,
        transactionHash: null,
        status: "failed",
        error: {
          code: "CHAIN_WRITE_UNAVAILABLE",
          message: "Sign createFirewall from the registry owner and submit that transaction hash. The API does not send it.",
        },
      },
      409,
    );
  }
  try {
    const sql = await getSql();
    const receipt = await ingestFirewallReceipt(sql, raw.transactionHash.toLowerCase() as `0x${string}`);
    if (receipt.state === "pending") {
      return apiJson(
        {
          firewallId: null,
          transactionHash: raw.transactionHash.toLowerCase(),
          status: "pending",
          error: { code: "CHAIN_UNAVAILABLE", message: "The transaction receipt is not available yet. The firewall is not confirmed." },
        },
        202,
      );
    }
    if (receipt.state === "indexed" && receipt.firewallIds[0]) {
      return apiJson({
        firewallId: receipt.firewallIds[0],
        transactionHash: raw.transactionHash.toLowerCase(),
        status: "confirmed",
      });
    }
    const message = "error" in receipt ? receipt.error : "The firewall was not created.";
    return apiJson(
      {
        firewallId: null,
        transactionHash: raw.transactionHash.toLowerCase(),
        status: "failed",
        error: { code: "EXECUTION_FAILED", message },
      },
      409,
    );
  } catch {
    return apiError(503, "CHAIN_UNAVAILABLE", "Monad testnet could not be read. Nothing was confirmed.");
  }
}

export async function postFirewallAllow(firewallId: string, kind: "target" | "function", request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const raw = body.value as Record<string, unknown>;
  if (typeof raw.target !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(raw.target)) {
    return apiError(400, "INVALID_REQUEST", "Target must be an address.");
  }
  if (kind === "function" && (typeof raw.selector !== "string" || !/^0x[a-fA-F0-9]{8}$/.test(raw.selector))) {
    return apiError(400, "INVALID_REQUEST", "Selector must be 4 bytes of hex.");
  }
  if (!configuredFirewall()) {
    return apiJson(
      {
        firewallId: null,
        transactionHash: null,
        status: "failed",
        error: { code: "FIREWALL_NOT_DEPLOYED", message: "The firewall contract is not deployed. No transaction was sent." },
      },
      409,
    );
  }
  if (!/^[1-9]\d*$/.test(firewallId)) return apiError(404, "FIREWALL_NOT_FOUND", "Firewall not found.");
  const firewall = await getIndexedFirewall(firewallId);
  if (!firewall) return apiError(404, "FIREWALL_NOT_FOUND", "Firewall not found.");
  return apiJson(
    {
      firewallId: firewall.id,
      transactionHash: null,
      status: "failed",
      error: {
        code: "CHAIN_WRITE_UNAVAILABLE",
        message:
          kind === "target"
            ? "Allowing a target is an owner transaction. No transaction was sent and the policy was not changed."
            : "Allowing a function is an owner transaction. No transaction was sent and the policy was not changed.",
      },
    },
    409,
  );
}

export async function postExecute(firewallId: string, request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) return body.response;
  if (!/^[1-9]\d*$/.test(firewallId)) {
    return refused("FIREWALL_NOT_FOUND", "Firewall not found.", 404);
  }
  const firewall = await getIndexedFirewall(firewallId);
  if (!firewall) return refused("FIREWALL_NOT_FOUND", "Firewall not found.", 404);
  const raw = body.value as Record<string, unknown>;
  const decision = assessFirewallCall(firewall, {
    target: typeof raw.target === "string" ? raw.target : "",
    value: typeof raw.value === "string" ? raw.value : "",
    data: typeof raw.data === "string" ? raw.data : "",
  });
  if (!decision.ok) return refused(decision.code, decision.message, decision.code === "INVALID_REQUEST" ? 400 : 403);
  return refused(
    "CHAIN_WRITE_UNAVAILABLE",
    "The call matches the indexed firewall policy, but no executor signer is configured. The firewall was not bypassed and no transaction was sent.",
    409,
  );
}

function refused(code: string, message: string, status: number): Response {
  return apiJson({ executionId: null, transactionHash: null, status: "failed", error: { code, message } }, status);
}

export async function getExecution(executionId: string): Promise<Response> {
  if (!HASH.test(executionId)) return apiError(400, "INVALID_REQUEST", "Execution id must be a 32-byte hex value.");
  const sql = await getSql();
  const rows = await sql<{
    execution_id: string;
    firewall_id: string;
    agent_id: string;
    target: string;
    selector: string;
    value: string;
    tx_hash: string;
    block_number: number;
  }>`
    select execution_id, firewall_id, agent_id, target, selector, value, tx_hash, block_number
    from firewall_actions
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId.toLowerCase()}
  `;
  const row = rows[0];
  if (!row) return apiError(404, "EXECUTION_NOT_FOUND", "No indexed execution has that id.");
  return apiJson({
    executionId: row.execution_id,
    firewallId: row.firewall_id,
    agentId: row.agent_id,
    target: row.target,
    selector: row.selector,
    value: row.value,
    transactionHash: row.tx_hash,
    blockNumber: Number(row.block_number),
    status: "executed",
  });
}

export async function getProof(executionId: string): Promise<Response> {
  if (!HASH.test(executionId)) return apiError(404, "PROOF_NOT_FOUND", "No proof is indexed for that execution.");
  const proof = await getExecutionProof(executionId.toLowerCase());
  if (!proof) return apiError(404, "PROOF_NOT_FOUND", "No proof is indexed for that execution. A transaction hash is not a proof.");
  return apiJson(proofJson(proof));
}

export async function postProofVerify(executionId: string): Promise<Response> {
  if (!HASH.test(executionId)) return apiError(404, "PROOF_NOT_FOUND", "No proof is indexed for that execution.");
  const proof = await verifyIndexedExecution(executionId.toLowerCase(), true);
  if (!proof) return apiError(404, "PROOF_NOT_FOUND", "No AgentAction is indexed for this execution. A transaction hash is not a proof.");
  return apiJson(proofJson(proof));
}

function proofJson(proof: {
  executionId: string;
  agentId: string;
  firewallId: string;
  verificationStatus: string;
  proofHash: string | null;
  txHash: string;
  anchored: boolean;
  verificationMethod: string | null;
  verifiedAt: string | null;
}) {
  return {
    executionId: proof.executionId,
    agentId: proof.agentId,
    firewallId: proof.firewallId,
    status: proof.verificationStatus,
    proofHash: proof.proofHash,
    transactionHash: proof.txHash,
    anchored: proof.anchored,
    verificationMethod: proof.verificationMethod,
    verifiedAt: proof.verifiedAt,
  };
}

export async function postWebhook(request: Request, ctx: ApiContext): Promise<Response> {
  if (!ctx.principal) return apiError(401, "UNAUTHORIZED", "A bearer API key is required.");
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const raw = body.value as { url?: unknown; events?: unknown };
  const url = typeof raw.url === "string" ? parseWebhookUrl(raw.url) : null;
  if (!url) return apiError(400, "INVALID_REQUEST", "Webhook URL must be https, or http on localhost.");
  const events = parseWebhookEvents(raw.events);
  if (!events) return apiError(400, "INVALID_REQUEST", "Choose at least one supported webhook event.");
  try {
    const created = await createWebhook(ctx.principal.userId, url, events);
    return apiJson({ ...created.record, secret: created.secret }, 201);
  } catch (err) {
    return apiError(400, "INVALID_REQUEST", err instanceof Error ? err.message : "The webhook was not created.");
  }
}

export async function getWebhooks(ctx: ApiContext): Promise<Response> {
  if (!ctx.principal) return apiError(401, "UNAUTHORIZED", "A bearer API key is required.");
  const hooks = await listWebhooks(ctx.principal.userId);
  return apiJson({ webhooks: hooks });
}

export async function deleteWebhook(webhookId: string, ctx: ApiContext): Promise<Response> {
  if (!ctx.principal) return apiError(401, "UNAUTHORIZED", "A bearer API key is required.");
  const ok = await disableWebhook(ctx.principal.userId, webhookId);
  if (!ok) return apiError(404, "INVALID_REQUEST", "Webhook not found.");
  return apiJson({ id: webhookId, disabled: true });
}
