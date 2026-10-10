/**
 * One-click agent setup: one wallet connection, ideally one signature.
 *
 * The owner's wallet signs the setup (register agent, create firewall, allow target and function,
 * fund a session executor). A fresh browser session key is the agent's executor, so after setup
 * the agent acts on its own and the owner's wallet is never the hot key. That is the same split
 * an agent runtime uses: owner key configures, a scoped session key executes.
 *
 * - Wallets that implement EIP-5792 (wallet_sendCalls) get every setup call in ONE confirmation,
 *   atomically. On an EIP-7702 or smart-contract account, msg.sender is still the owner's account,
 *   so the registry records the right owner.
 * - Against AgentFirewallV3, setup is two calls (registerAgent + createFirewallWithPermissions,
 *   which also forwards the session key's gas), so even without EIP-5792 it is two confirmations.
 * - Otherwise the calls are sent one after another automatically, each re-reading the real ids
 *   from the previous receipt; nothing has to be clicked between them.
 *
 * The session key is a demo convenience: it lives in this browser's storage, holds only the gas
 * stipend, can only call what the firewall allows, and (on V3) expires after a day.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentFirewallAbi, agentRegistryAbi, demoProtocolAbi } from "@/lib/chain/abi";
import { MONAD } from "@/lib/chain/network";
import { encodeCapabilities } from "@/lib/agents/capabilities";
import { injectedProvider, noWalletMessage } from "@/lib/chain/injected";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type Call = { to: `0x${string}`; data: Hex; value?: bigint; label: string };

export const firewallV3Abi = parseAbi([
  "struct Permission { address target; string name; bytes4[] selectors; }",
  "function createFirewallWithPermissions(uint256 agentId, address executor, uint64 executorValidUntil, bool allowValueTransfer, uint256 maxValuePerTransaction, uint256 maxValuePerPeriod, uint64 periodDuration, Permission[] permissions) payable returns (uint256 firewallId, address vault)",
  "function predictVault(uint256 firewallId) view returns (address)",
  "function vaultOf(uint256 firewallId) view returns (address)",
  "event VaultCreated(uint256 indexed firewallId, uint256 indexed agentId, address vault, uint64 timestamp)",
]);

export const DEPOSIT_SELECTOR = toFunctionSelector("deposit(uint256,uint256)");
/** Gas the session key is given: enough for a few executes at Monad's charged gas limit. */
const SESSION_GAS_UNITS = 600_000n;
const SESSION_STORAGE = "agenttrace.session-key";

const chain = defineChain({
  id: MONAD.chainId,
  name: MONAD.name,
  nativeCurrency: { name: "MON", symbol: MONAD.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [MONAD.rpcUrl] } },
});

function injected(): EthereumProvider {
  const eth = injectedProvider();
  if (!eth) throw new Error(noWalletMessage());
  return eth;
}

/** Public reads go through the wallet's provider: it is already on Monad and has no CORS limits. */
export function readClient() {
  return createPublicClient({ chain, transport: custom(injected()) });
}

// --- Session key -----------------------------------------------------------------------------

export function loadSessionKey(): Hex {
  try {
    const saved = window.localStorage.getItem(SESSION_STORAGE);
    if (saved && /^0x[0-9a-f]{64}$/i.test(saved)) return saved as Hex;
  } catch {
    // storage blocked: a fresh key per page load still works for one run
  }
  const key = generatePrivateKey();
  try {
    window.localStorage.setItem(SESSION_STORAGE, key);
  } catch {
    // ignore
  }
  return key;
}

export function forgetSessionKey() {
  try {
    window.localStorage.removeItem(SESSION_STORAGE);
  } catch {
    // ignore
  }
}

export function sessionAccount(key: Hex) {
  return privateKeyToAccount(key);
}

/**
 * The session key signs locally; the signed transaction is broadcast through the wallet's own
 * provider (eth_sendRawTransaction), so no extra RPC endpoint or CORS setup is needed and the
 * wallet shows no prompt.
 */
export function sessionWallet(key: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain,
    transport: custom(injected()),
  });
}

// --- Wallet batching (EIP-5792) --------------------------------------------------------------

export async function supportsBatch(owner: `0x${string}`): Promise<boolean> {
  try {
    const caps = (await injected().request({
      method: "wallet_getCapabilities",
      params: [owner, [MONAD.chainIdHex]],
    })) as Record<string, Record<string, { status?: string; supported?: boolean }>> | null;
    const forChain = caps?.[MONAD.chainIdHex] ?? caps?.[String(MONAD.chainId)];
    const atomic = forChain?.atomic?.status;
    return (
      atomic === "supported" || atomic === "ready" || forChain?.atomicBatch?.supported === true
    );
  } catch {
    return false;
  }
}

/** Send all calls as one atomic wallet request; resolves with the transaction hashes. */
export async function sendBatch(
  owner: `0x${string}`,
  calls: Call[],
  onWait: () => void,
): Promise<`0x${string}`[]> {
  const eth = injected();
  const result = (await eth.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        chainId: MONAD.chainIdHex,
        from: owner,
        atomicRequired: true,
        calls: calls.map((call) => ({
          to: call.to,
          data: call.data,
          ...(call.value ? { value: `0x${call.value.toString(16)}` } : {}),
        })),
      },
    ],
  })) as string | { id: string };
  const id = typeof result === "string" ? result : result.id;
  onWait();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = (await eth.request({ method: "wallet_getCallsStatus", params: [id] })) as {
      status: number | string;
      receipts?: { transactionHash: `0x${string}`; status: string }[];
    };
    const code =
      typeof status.status === "number" ? status.status : status.status === "CONFIRMED" ? 200 : 100;
    if (code >= 200 && code < 300) {
      const receipts = status.receipts ?? [];
      if (receipts.some((r) => r.status !== "0x1" && r.status !== "success")) {
        throw new Error("The setup batch reverted. Nothing was changed.");
      }
      return [...new Set(receipts.map((r) => r.transactionHash))];
    }
    if (code >= 400)
      throw new Error("The wallet reported the setup batch as failed. Nothing was changed.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The setup batch did not confirm in time.");
}

// --- Setup plan ------------------------------------------------------------------------------

export type SetupInput = {
  registry: `0x${string}`;
  firewall: `0x${string}`;
  target: `0x${string}`;
  targetName: string;
  selectors: `0x${string}`[];
  agent: { name: string; description: string; metadataURI: string; capabilities: string[] };
  owner: `0x${string}`;
  executor: `0x${string}`;
};

export async function isFirewallV3(firewall: `0x${string}`): Promise<boolean> {
  try {
    await readClient().readContract({
      address: firewall,
      abi: firewallV3Abi,
      functionName: "predictVault",
      args: [1n],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail early, in plain words, when the wallet cannot pay for the setup. Without this a wallet
 * with no MON surfaces an RPC error such as "Missing or invalid parameters".
 * Budget: the session key's stipend plus up to five setup transactions at about 300k gas each
 * (Monad charges the gas limit).
 */
export async function ensureSetupFunds(owner: `0x${string}`): Promise<void> {
  const client = readClient();
  const [balance, price] = await Promise.all([client.getBalance({ address: owner }), client.getGasPrice()]);
  const needed = price * (SESSION_GAS_UNITS + 5n * 300_000n);
  if (balance >= needed) return;
  const fmt = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toFixed(4);
  const faucet = MONAD.key === "testnet" ? " Get free test MON at https://faucet.monad.xyz, then press Retry." : "";
  throw new Error(
    `Your wallet has ${fmt(balance)} ${MONAD.nativeSymbol} on ${MONAD.label}; the demo needs about ${fmt(needed)} ${MONAD.nativeSymbol} for gas. No transaction was sent.${faucet}`,
  );
}

export async function sessionStipend(): Promise<bigint> {
  const price = await readClient().getGasPrice();
  return price * SESSION_GAS_UNITS;
}

/** Build the setup calls using the ids the next transactions will get. */
export async function planSetup(
  input: SetupInput,
  v3: boolean,
  ids?: { agentId?: bigint; firewallId?: bigint },
) {
  const client = readClient();
  const [nextAgent, nextFirewall, stipend] = await Promise.all([
    ids?.agentId ??
      client.readContract({
        address: input.registry,
        abi: agentRegistryAbi,
        functionName: "nextAgentId",
      }),
    ids?.firewallId ??
      client.readContract({
        address: input.firewall,
        abi: agentFirewallAbi,
        functionName: "nextFirewallId",
      }),
    sessionStipend(),
  ]);
  const agentId = nextAgent as bigint;
  const firewallId = nextFirewall as bigint;
  const register: Call = {
    label: "Register agent",
    to: input.registry,
    data: encodeFunctionData({
      abi: agentRegistryAbi,
      functionName: "registerAgent",
      args: [
        input.agent.name,
        input.agent.description,
        input.agent.metadataURI,
        encodeCapabilities(input.agent.capabilities),
      ],
    }),
  };
  if (v3) {
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 86_400);
    return {
      agentId,
      firewallId,
      calls: [
        register,
        {
          label: "Create firewall, vault and session key",
          to: input.firewall,
          value: stipend,
          data: encodeFunctionData({
            abi: firewallV3Abi,
            functionName: "createFirewallWithPermissions",
            args: [
              agentId,
              input.executor,
              validUntil,
              false,
              0n,
              0n,
              86_400n,
              [{ target: input.target, name: input.targetName, selectors: input.selectors }],
            ],
          }),
        },
      ] as Call[],
    };
  }
  const fw = (
    functionName: "createFirewall" | "allowTarget" | "allowFunction",
    args: readonly unknown[],
  ) => encodeFunctionData({ abi: agentFirewallAbi, functionName, args: args as never });
  return {
    agentId,
    firewallId,
    calls: [
      register,
      {
        label: "Create firewall",
        to: input.firewall,
        data: fw("createFirewall", [agentId, input.executor, false, 0n, 0n, 86_400n]),
      },
      {
        label: "Allow target",
        to: input.firewall,
        data: fw("allowTarget", [firewallId, input.target, input.targetName]),
      },
      ...input.selectors.map((selector) => ({
        label: "Allow function",
        to: input.firewall,
        data: fw("allowFunction", [firewallId, input.target, selector]),
      })),
      { label: "Fund session key gas", to: input.executor, data: "0x" as Hex, value: stipend },
    ] as Call[],
  };
}

/** Read the ids a confirmed setup transaction really produced. */
export async function idsFromReceipt(hash: `0x${string}`, registry: string, firewall: string) {
  const receipt = await readClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("A setup transaction reverted.");
  let agentId: bigint | undefined;
  let firewallId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      if (log.address.toLowerCase() === registry.toLowerCase()) {
        const ev = decodeEventLog({ abi: agentRegistryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "AgentRegistered") agentId = (ev.args as { agentId: bigint }).agentId;
      }
      if (log.address.toLowerCase() === firewall.toLowerCase()) {
        const ev = decodeEventLog({ abi: agentFirewallAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "FirewallCreated")
          firewallId = (ev.args as { firewallId: bigint }).firewallId;
      }
    } catch {
      // another event
    }
  }
  return { agentId, firewallId };
}

/**
 * Run the setup with as few confirmations as the wallet allows. onProgress reports
 * "Confirm 2 of 5 in your wallet" style messages.
 */
export async function runSetup(
  input: SetupInput,
  send: (call: Call) => Promise<`0x${string}`>,
  onProgress: (message: string) => void,
): Promise<{
  agentId: bigint;
  firewallId: bigint;
  txHashes: `0x${string}`[];
  batched: boolean;
  v3: boolean;
}> {
  const v3 = await isFirewallV3(input.firewall);
  const plan = await planSetup(input, v3);
  if (await supportsBatch(input.owner)) {
    onProgress(`Confirm ${plan.calls.length} setup steps in one wallet request`);
    try {
      const txHashes = await sendBatch(input.owner, plan.calls, () =>
        onProgress("Setup submitted. Waiting for Monad..."),
      );
      let agentId: bigint | undefined;
      let firewallId: bigint | undefined;
      for (const hash of txHashes) {
        const ids = await idsFromReceipt(hash, input.registry, input.firewall);
        agentId ??= ids.agentId;
        firewallId ??= ids.firewallId;
      }
      if (agentId == null || firewallId == null)
        throw new Error("The setup batch confirmed without creating an agent and firewall.");
      return { agentId, firewallId, txHashes, batched: true, v3 };
    } catch (err) {
      const code =
        typeof err === "object" && err && "code" in err ? (err as { code: unknown }).code : null;
      if (code === 4001) throw new Error("The wallet request was rejected.");
      // Wallet advertised batching but could not do it on this chain: fall through to sequential.
      if (!(code === 4100 || code === 4200 || code === 5700 || code === 5710 || code === -32601))
        throw err;
    }
  }
  // Sequential: one confirmation per call, sent back to back. Ids are re-read from receipts.
  const txHashes: `0x${string}`[] = [];
  const total = plan.calls.length;
  onProgress(`Confirm 1 of ${total} in your wallet: ${plan.calls[0].label}`);
  const registerHash = await send(plan.calls[0]);
  txHashes.push(registerHash);
  const { agentId } = await idsFromReceipt(registerHash, input.registry, input.firewall);
  if (agentId == null)
    throw new Error("The registration confirmed without an AgentRegistered event.");
  // Re-plan with the real agent id (and a fresh nextFirewallId) in case another agent landed first.
  const restPlan = await planSetup(input, v3, { agentId });
  const rest = restPlan.calls.slice(1);
  let firewallId: bigint | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    let call = rest[index];
    if (index > 0 && !v3 && firewallId != null && firewallId !== restPlan.firewallId) {
      call = (await planSetup(input, v3, { agentId, firewallId })).calls.slice(1)[index];
    }
    onProgress(`Confirm ${index + 2} of ${total} in your wallet: ${call.label}`);
    const hash = await send(call);
    txHashes.push(hash);
    if (index === 0)
      firewallId = (await idsFromReceipt(hash, input.registry, input.firewall)).firewallId;
  }
  if (firewallId == null)
    throw new Error("The firewall transaction confirmed without a FirewallCreated event.");
  return { agentId, firewallId, txHashes, batched: false, v3 };
}

// --- Session execution -----------------------------------------------------------------------

export function depositCalldata(agentId: bigint, amount: bigint) {
  return encodeFunctionData({
    abi: demoProtocolAbi,
    functionName: "deposit",
    args: [agentId, amount],
  });
}

export function withdrawCalldata(agentId: bigint, amount: bigint) {
  return encodeFunctionData({
    abi: demoProtocolAbi,
    functionName: "withdraw",
    args: [agentId, amount],
  });
}

/** The session key sends AgentFirewall.execute. No wallet prompt: it signs locally. */
export async function sessionExecute(
  key: Hex,
  firewall: `0x${string}`,
  firewallId: bigint,
  target: `0x${string}`,
  data: Hex,
) {
  const account = privateKeyToAccount(key);
  const calldata = encodeFunctionData({
    abi: agentFirewallAbi,
    functionName: "execute",
    args: [firewallId, target, 0n, data],
  });
  const client = readClient();
  // Simulate first: a call the firewall would block throws its custom error and nothing is sent.
  await client.call({ account: account.address, to: firewall, data: calldata });
  const gas = await client.estimateGas({ account: account.address, to: firewall, data: calldata });
  const hash = await sessionWallet(key).sendTransaction({
    to: firewall,
    data: calldata,
    gas: (gas * 120n) / 100n,
  });
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return hash;
}

/** Simulate a call as the session key without sending it. Returns the revert reason, if any. */
export async function sessionSimulate(
  key: Hex,
  firewall: `0x${string}`,
  firewallId: bigint,
  target: `0x${string}`,
  data: Hex,
) {
  const account = privateKeyToAccount(key);
  const calldata = encodeFunctionData({
    abi: agentFirewallAbi,
    functionName: "execute",
    args: [firewallId, target, 0n, data],
  });
  try {
    await readClient().call({ account: account.address, to: firewall, data: calldata });
    return null;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const named =
      /(FunctionNotAllowed|TargetNotAllowed|UnauthorizedExecutor|ExecutorExpired|ArgumentTooHigh)/.exec(
        text,
      );
    return named?.[1] ?? "Reverted";
  }
}

/** Return what is left of the session key's gas stipend to the owner. Best effort. */
export async function returnSessionGas(key: Hex, owner: `0x${string}`) {
  const account = privateKeyToAccount(key);
  const client = readClient();
  const [balance, gasPrice] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.getGasPrice(),
  ]);
  const fee = 21_000n * gasPrice * 2n;
  if (balance <= fee) return null;
  // Monad charges the gas limit at the max fee, so pay a fixed legacy fee and send the rest.
  return sessionWallet(key).sendTransaction({
    to: owner,
    value: balance - fee,
    gas: 21_000n,
    gasPrice: gasPrice * 2n,
    type: "legacy",
  });
}
