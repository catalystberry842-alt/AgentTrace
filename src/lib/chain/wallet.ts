import { BaseError, createPublicClient, custom, decodeErrorResult, encodeFunctionData } from "viem";
import { defineChain } from "viem";
import { agentFirewallAbi, agentRegistryAbi } from "@/lib/chain/abi";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { encodeCapabilities } from "@/lib/agents/capabilities";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type ChainTransaction = {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
};

/**
 * A signer the app can ask to authorize one transaction.
 * The current implementation is the injected browser wallet.
 * It does not create, store, or read a private key.
 * An embedded wallet or delegated signer can replace this later.
 */
export type ChainSigner = {
  getAddress: () => Promise<`0x${string}`>;
  signTransaction: (tx: ChainTransaction) => Promise<`0x${string}`>;
};

function provider(): EthereumProvider {
  const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!eth?.request) {
    throw new Error("No wallet found in this browser. Install one to authorize registration.");
  }
  return eth;
}

function errorCode(err: unknown): number | null {
  if (typeof err === "object" && err && "code" in err && typeof err.code === "number") return err.code;
  return null;
}

function walletError(err: unknown): Error {
  if (errorCode(err) === 4001) return new Error("The wallet request was rejected.");
  if (err instanceof Error && err.message) return err;
  return new Error("The wallet could not submit the transaction.");
}

async function ensureMonad(eth: EthereumProvider): Promise<void> {
  const current = await eth.request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === MONAD_TESTNET.chainIdHex) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_TESTNET.chainIdHex }],
    });
  } catch (err) {
    if (errorCode(err) !== 4902) throw walletError(err);
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: MONAD_TESTNET.chainIdHex,
          chainName: MONAD_TESTNET.name,
          nativeCurrency: { name: "MON", symbol: MONAD_TESTNET.nativeSymbol, decimals: 18 },
          rpcUrls: [MONAD_TESTNET.rpcUrl, ...MONAD_TESTNET.fallbackRpcUrls],
          blockExplorerUrls: [MONAD_TESTNET.explorerUrl],
        },
      ],
    });
  }
  const after = await eth.request({ method: "eth_chainId" });
  if (typeof after !== "string" || after.toLowerCase() !== MONAD_TESTNET.chainIdHex) {
    throw new Error("Wallet is not on Monad testnet.");
  }
}

/**
 * Wallets return the hash as soon as the transaction is broadcast. AgentTrace's server reads
 * the transaction from a public RPC node, which may not have it yet, so wait (through the
 * wallet's own provider) until a receipt exists. After the timeout the hash is returned anyway
 * and the server reports the record as pending.
 */
async function waitForInclusion(eth: EthereumProvider, hash: `0x${string}`, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (receipt && typeof receipt === "object") return;
    } catch {
      // Some wallets reject read calls briefly after a send; keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

export async function getSigner(): Promise<ChainSigner> {
  const eth = provider();
  let accounts: unknown;
  try {
    accounts = await eth.request({ method: "eth_requestAccounts" });
  } catch (err) {
    throw walletError(err);
  }
  const from = Array.isArray(accounts) ? accounts[0] : null;
  if (typeof from !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(from)) {
    throw new Error("Wallet did not return an account.");
  }
  const address = from as `0x${string}`;
  await ensureMonad(eth);
  return {
    getAddress: async () => address,
    signTransaction: async (tx) => {
      const request: Record<string, string> = {
        from: address,
        to: tx.to,
        data: tx.data,
      };
      if (tx.value != null) request.value = `0x${tx.value.toString(16)}`;
      let hash: unknown;
      try {
        hash = await eth.request({
          method: "eth_sendTransaction",
          params: [request],
        });
      } catch (err) {
        throw walletError(err);
      }
      if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        throw new Error("Wallet did not return a transaction hash.");
      }
      await waitForInclusion(eth, hash as `0x${string}`);
      return hash as `0x${string}`;
    },
  };
}

export async function sendRegisterTransaction(input: {
  registry: `0x${string}`;
  name: string;
  description: string;
  metadataURI: string;
  capabilities: string[];
}): Promise<`0x${string}`> {
  const signer = await getSigner();
  const data = encodeFunctionData({
    abi: agentRegistryAbi,
    functionName: "registerAgent",
    args: [input.name, input.description, input.metadataURI, encodeCapabilities(input.capabilities)],
  });
  return signer.signTransaction({ to: input.registry, data });
}

const monadChain = defineChain({
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  nativeCurrency: { name: "MON", symbol: MONAD_TESTNET.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
});

/** Find revert data anywhere in a viem error chain and name the firewall's custom error. */
function firewallErrorName(err: BaseError): string | null {
  const hexOf = (value: unknown): `0x${string}` | null => {
    if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) return value as `0x${string}`;
    if (value && typeof value === "object" && "data" in value) return hexOf((value as { data: unknown }).data);
    return null;
  };
  let data: `0x${string}` | null = null;
  err.walk((inner) => {
    data ??= hexOf((inner as { data?: unknown }).data);
    return false;
  });
  if (!data) return null;
  try {
    return decodeErrorResult({ abi: agentFirewallAbi, data }).errorName;
  } catch {
    return null;
  }
}

function chainRevert(err: unknown): Error {
  if (err instanceof BaseError) {
    const name = firewallErrorName(err);
    if (name) return new Error(name);
    const reason = err.shortMessage.replace(/^Execution reverted:?\s*/i, "").trim();
    return new Error(reason || "The contract rejected this action.");
  }
  if (err instanceof Error && err.message) return err;
  return new Error("The contract rejected this action.");
}

export async function sendFirewallTransaction(input: {
  to: `0x${string}`;
  functionName:
    | "createFirewall"
    | "setExecutor"
    | "updatePolicy"
    | "allowTarget"
    | "disableTarget"
    | "allowFunction"
    | "disableFunction"
    | "pauseFirewall"
    | "unpauseFirewall"
    | "deactivateFirewall"
    | "execute";
  args: readonly unknown[];
  value?: bigint;
}): Promise<`0x${string}`> {
  const signer = await getSigner();
  const data = encodeFunctionData({
    abi: agentFirewallAbi,
    functionName: input.functionName,
    args: input.args as never,
  });
  // Simulate through the wallet's own provider: it is already switched to Monad testnet, so the
  // check runs on the same chain and node the transaction will be sent to.
  const client = createPublicClient({ chain: monadChain, transport: custom(provider()) });
  try {
    await client.call({
      account: await signer.getAddress(),
      to: input.to,
      data,
      value: input.value,
    });
  } catch (err) {
    throw chainRevert(err);
  }
  return signer.signTransaction({ to: input.to, data, value: input.value });
}
