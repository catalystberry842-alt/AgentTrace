import {
  createPublicClient,
  createWalletClient,
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  defineChain,
  fallback,
  http,
  parseAbi,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgentTraceError } from "../errors/error.ts";

/**
 * Networks with a recorded AgentTrace deployment. Addresses match the committed
 * deployment records in src/lib/chain/deployment*.ts (same deployer nonces on both chains).
 */
export const TRACE_NETWORKS = {
  "monad-testnet": {
    chainId: 10143,
    rpcUrls: ["https://testnet-rpc.monad.xyz", "https://rpc-testnet.monadinfra.com"],
    explorer: "https://testnet.monadvision.com",
    appUrl: "https://agenttrace-plum.vercel.app",
    firewall: "0x694178a2396b54bff6a25caa0aa9cca6eb079441" as Address,
  },
  "monad-mainnet": {
    chainId: 143,
    rpcUrls: ["https://rpc.monad.xyz", "https://rpc-mainnet.monadinfra.com"],
    explorer: "https://monadvision.com",
    appUrl: "https://agenttrace-mainnet.vercel.app",
    firewall: "0x694178a2396b54bff6a25caa0aa9cca6eb079441" as Address,
  },
} as const;

export type TraceNetwork = keyof typeof TRACE_NETWORKS;

const firewallAbi = parseAbi([
  "function execute(uint256 firewallId, address target, uint256 value, bytes data) payable",
  "event AgentAction(uint256 indexed agentId, uint256 indexed firewallId, address indexed executor, address target, bytes4 functionSelector, uint256 value, uint256 executionNonce, bytes32 executionId, bytes32 calldataHash, uint64 timestamp)",
]);

export type TraceCallInput = {
  network: TraceNetwork;
  /** The firewall's executor. A hex private key or a viem Account. */
  signer: Hex | Account;
  firewallId: bigint | number;
  target: Address;
  /** Calldata for the target, e.g. from viem encodeFunctionData. */
  data: Hex;
  value?: bigint;
  /** Override the RPC (default: public Monad RPCs with fallback) or AgentTrace app origin. */
  rpcUrl?: string;
  appUrl?: string;
  /** How long to wait for the AgentTrace verifier (ms). Default 60s. */
  verifyTimeoutMs?: number;
};

export type TraceCallResult = {
  txHash: Hex;
  executionId: Hex;
  agentId: bigint;
  proofStatus: string | null;
  proofHash: Hex | null;
  proofUrl: string;
  explorerUrl: string;
};

/**
 * Route one agent call through AgentFirewall.execute and return its AgentTrace proof.
 *
 * The call is simulated first, so a call the firewall would block throws
 * FIREWALL_REJECTED and sends nothing. After the receipt, AgentTrace re-reads the
 * transaction and receipt independently; proofStatus is whatever its verifier says.
 */
export async function traceCall(input: TraceCallInput): Promise<TraceCallResult> {
  const net = TRACE_NETWORKS[input.network];
  if (!net) throw new AgentTraceError("BAD_NETWORK", `Unknown network ${String(input.network)}.`, 400);
  const account = typeof input.signer === "string" ? privateKeyToAccount(input.signer) : input.signer;
  const chain = defineChain({
    id: net.chainId,
    name: input.network,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: input.rpcUrl ? [input.rpcUrl] : [...net.rpcUrls] } },
  });
  const transport = input.rpcUrl ? http(input.rpcUrl) : fallback(net.rpcUrls.map((url) => http(url, { timeout: 20_000 })));
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account });
  const args = [BigInt(input.firewallId), input.target, input.value ?? 0n, input.data] as const;

  let request;
  try {
    ({ request } = await pub.simulateContract({
      account,
      address: net.firewall,
      abi: firewallAbi,
      functionName: "execute",
      args,
      value: input.value ?? 0n,
    }));
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    const reason = (error instanceof BaseError ? error.shortMessage : String(error)).split("\n")[0];
    if (revert) {
      throw new AgentTraceError("FIREWALL_REJECTED", `The firewall would reject this call. Nothing was sent. ${reason}`, 403);
    }
    throw new AgentTraceError("RPC_UNAVAILABLE", `Could not simulate the call. Nothing was sent. ${reason}`, 503);
  }

  const txHash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new AgentTraceError("EXECUTION_REVERTED", `Transaction ${txHash} reverted.`, 409);
  }
  let executionId: Hex | undefined;
  let agentId = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== net.firewall.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: firewallAbi, data: log.data, topics: log.topics });
      if (event.eventName === "AgentAction") {
        executionId = event.args.executionId;
        agentId = event.args.agentId;
      }
    } catch {
      // other firewall events
    }
  }
  if (!executionId) throw new AgentTraceError("NO_AGENT_ACTION", `No AgentAction in ${txHash}.`, 502);

  const appUrl = (input.appUrl ?? net.appUrl).replace(/\/$/, "");
  const deadline = Date.now() + Math.min(input.verifyTimeoutMs ?? 60_000, 180_000);
  let proofStatus: string | null = null;
  let proofHash: Hex | null = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${appUrl}/api/proofs/${executionId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionHash: txHash }),
    }).catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as { status?: string; proofHash?: Hex | null };
      proofStatus = body.status ?? null;
      proofHash = body.proofHash ?? null;
      if (proofStatus && proofStatus !== "pending") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  return {
    txHash,
    executionId,
    agentId,
    proofStatus,
    proofHash,
    proofUrl: `${appUrl}/proofs/${executionId}`,
    explorerUrl: `${net.explorer}/tx/${txHash}`,
  };
}
