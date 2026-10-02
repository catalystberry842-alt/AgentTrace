import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const root = join(import.meta.dirname, "..");
const artifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentRegistry.json"), "utf8"));
const key = process.env.MONAD_DEPLOYER_PRIVATE_KEY?.trim();

if (!key) {
  console.log("Deployment skipped: MONAD_DEPLOYER_PRIVATE_KEY is not set. No transaction was sent.");
  process.exit(0);
}
if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
  console.error("MONAD_DEPLOYER_PRIVATE_KEY is not a 32-byte hex private key. No transaction was sent.");
  process.exit(1);
}

const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const account = privateKeyToAccount(key);
const transport = http("https://testnet-rpc.monad.xyz", { timeout: 20_000 });
const wallet = createWalletClient({ account, chain, transport });
const client = createPublicClient({ chain, transport });

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  account,
});
console.log(`submitted ${hash}`);
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("Deployment transaction did not succeed. deployment.ts was not updated.");
  process.exit(1);
}
const code = await client.getCode({ address: receipt.contractAddress });
if (!code || code === "0x") {
  console.error("No bytecode at the receipt address. deployment.ts was not updated.");
  process.exit(1);
}

const address = receipt.contractAddress.toLowerCase();
const block = Number(receipt.blockNumber);
const file = `/**
 * Public record of the Agent Registry deployment.
 * Written only after a confirmed Monad transaction.
 */
export const deployment = {
  chainId: 10143 as const,
  agentRegistry: "${address}" as \`0x\${string}\`,
  deployBlock: ${block},
  deployTx: "${hash.toLowerCase()}" as \`0x\${string}\`,
};
`;
writeFileSync(join(root, "src/lib/chain/deployment.ts"), file);
console.log(`deployed ${address} block ${block}`);
