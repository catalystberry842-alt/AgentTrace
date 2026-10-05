/**
 * Deploy AgentRegistry, AgentFirewall, AgentProof and DemoProtocol to Monad and write the
 * confirmed addresses to the deployment record.
 *
 *   MONAD_DEPLOYER_PRIVATE_KEY=0x... npm run deploy:testnet     # chain 10143 -> src/lib/chain/deployment.ts
 *   MONAD_DEPLOYER_PRIVATE_KEY=0x... npm run deploy:mainnet     # chain 143   -> src/lib/chain/deployment-mainnet.ts
 *
 * - Mainnet spends real MON, so it runs only with MONAD_NETWORK=mainnet and --confirm-mainnet.
 * - Refuses an RPC whose chain id does not match the selected network.
 * - Checks the deployer balance against an estimate before sending anything.
 * - A contract already present in deployment.ts (with bytecode on chain) is skipped, so a
 *   partial run can be resumed. The record is written after each confirmed deployment.
 * - AgentProof verifier: address of AGENT_PROOF_VERIFIER_PRIVATE_KEY, else
 *   AGENT_PROOF_VERIFIER_ADDRESS, else the deployer. The owner can change it later with setVerifier.
 * - MONAD_DEPLOY_RPC_URL may point at another https endpoint, or a local node for a dry run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = join(import.meta.dirname, "..");
const MAINNET = process.env.MONAD_NETWORK === "mainnet";
if (MAINNET && !process.argv.includes("--confirm-mainnet")) {
  console.error("Mainnet deploys spend real MON. Re-run with --confirm-mainnet. No transaction was sent.");
  process.exit(1);
}
const recordPath = join(root, MAINNET ? "src/lib/chain/deployment-mainnet.ts" : "src/lib/chain/deployment.ts");
const CHAIN_ID = MAINNET ? 143 : 10143;
const NETWORK_NAME = MAINNET ? "Monad mainnet" : "Monad testnet";
const EXPORT_NAME = MAINNET ? "mainnetDeployment" : "deployment";
// Monad charges the gas limit, not gas used. Keep the margin small on mainnet.
const GAS_MARGIN = MAINNET ? 110n : 120n;

const key = process.env.MONAD_DEPLOYER_PRIVATE_KEY?.trim();
if (!key) {
  console.log("Deployment skipped: MONAD_DEPLOYER_PRIVATE_KEY is not set. No transaction was sent.");
  process.exit(0);
}
if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
  console.error("MONAD_DEPLOYER_PRIVATE_KEY is not a 32-byte hex private key. No transaction was sent.");
  process.exit(1);
}

const rpcUrl =
  process.env.MONAD_DEPLOY_RPC_URL?.trim() || (MAINNET ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
if (!/^https:\/\//.test(rpcUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl)) {
  console.error("MONAD_DEPLOY_RPC_URL must be https, or http on localhost. No transaction was sent.");
  process.exit(1);
}

const chain = defineChain({
  id: CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(key);
const transport = http(rpcUrl, { timeout: 30_000 });
const wallet = createWalletClient({ account, chain, transport });
const client = createPublicClient({ chain, transport });

const remoteChainId = await client.getChainId();
if (remoteChainId !== CHAIN_ID) {
  console.error(`RPC reports chain ${remoteChainId}, expected ${CHAIN_ID}. No transaction was sent.`);
  process.exit(1);
}

function verifierAddress() {
  const vk = process.env.AGENT_PROOF_VERIFIER_PRIVATE_KEY?.trim();
  if (vk && /^0x[a-fA-F0-9]{64}$/.test(vk)) return privateKeyToAccount(vk).address;
  const va = process.env.AGENT_PROOF_VERIFIER_ADDRESS?.trim();
  if (va && /^0x[a-fA-F0-9]{40}$/.test(va)) return va;
  return account.address;
}

const artifact = (name) => {
  const a = JSON.parse(readFileSync(join(root, `contracts/out/${name}.json`), "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.startsWith("0x") ? a.bytecode : `0x${a.bytecode}` };
};

// --- deployment record --------------------------------------------------------------------
const FIELDS = {
  agentRegistry: ["agentRegistry", "deployBlock", "deployTx"],
  agentFirewall: ["agentFirewall", "firewallDeployBlock", "firewallDeployTx"],
  agentProof: ["agentProof", "proofDeployBlock", "proofDeployTx"],
  demoProtocol: ["demoProtocol", "demoProtocolDeployBlock", "demoProtocolDeployTx"],
};

function readRecord() {
  let text = "";
  try {
    text = readFileSync(recordPath, "utf8");
  } catch {
    // No record yet for this network.
  }
  const pick = (field) => {
    const m = text.match(new RegExp(`\\b${field}:\\s*("0x[0-9a-fA-F]+"|\\d+|null)`));
    if (!m || m[1] === "null") return null;
    return m[1].startsWith('"') ? m[1].slice(1, -1).toLowerCase() : Number(m[1]);
  };
  const record = {};
  for (const fields of Object.values(FIELDS)) for (const f of fields) record[f] = pick(f);
  return record;
}

function writeRecord(r) {
  const addr = (v) => (v ? `"${v}" as \`0x\${string}\`` : "null as `0x${string}` | null");
  const num = (v) => (v == null ? "null as number | null" : `${v} as number | null`);
  const file = `/**
 * Public record of contract deployments on ${NETWORK_NAME} (chain id ${CHAIN_ID}).
 * Written by scripts/deploy-contracts.mjs only after each confirmed Monad transaction.
 * Never invent an address here.
 */
export const ${EXPORT_NAME} = {
  chainId: ${CHAIN_ID} as const,
  agentRegistry: ${addr(r.agentRegistry)},
  deployBlock: ${num(r.deployBlock)},
  deployTx: ${addr(r.deployTx)},
  agentFirewall: ${addr(r.agentFirewall)},
  firewallDeployBlock: ${num(r.firewallDeployBlock)},
  firewallDeployTx: ${addr(r.firewallDeployTx)},
  agentProof: ${addr(r.agentProof)},
  proofDeployBlock: ${num(r.proofDeployBlock)},
  proofDeployTx: ${addr(r.proofDeployTx)},
  /** AgentTrace Demo Protocol. Null until a confirmed deployment exists. */
  demoProtocol: ${addr(r.demoProtocol)},
  demoProtocolDeployBlock: ${num(r.demoProtocolDeployBlock)},
  demoProtocolDeployTx: ${addr(r.demoProtocolDeployTx)},
};
`;
  writeFileSync(recordPath, file);
}

const record = readRecord();

async function alreadyDeployed(address) {
  if (!address) return false;
  const code = await client.getCode({ address });
  return Boolean(code && code !== "0x");
}

// --- plan and cost check -----------------------------------------------------------------
const plan = [
  { key: "agentRegistry", name: "AgentRegistry", args: () => [] },
  { key: "agentFirewall", name: "AgentFirewall", args: () => [record.agentRegistry] },
  { key: "agentProof", name: "AgentProof", args: () => [verifierAddress()] },
  { key: "demoProtocol", name: "DemoProtocol", args: () => [] },
];

const todo = [];
for (const step of plan) {
  if (await alreadyDeployed(record[step.key])) {
    console.log(`${step.name} already deployed at ${record[step.key]}, skipping.`);
  } else {
    todo.push(step);
  }
}
if (!todo.length) {
  console.log("All four contracts are already deployed. Nothing to do.");
  process.exit(0);
}

// Firewall gas does not depend on the registry address value, so a placeholder is fine for the estimate.
const placeholder = "0x000000000000000000000000000000000000dEaD";
let gasTotal = 0n;
for (const step of todo) {
  const { abi, bytecode } = artifact(step.name);
  const args = step.key === "agentFirewall" && !record.agentRegistry ? [placeholder] : step.args();
  const data = encodeDeployData({ abi, bytecode, args });
  gasTotal += await client.estimateGas({ account: account.address, data });
}
const gasPrice = await client.getGasPrice();
// Monad charges the gas limit, so budget the limit with a 20% margin.
const needed = ((gasTotal * GAS_MARGIN) / 100n) * gasPrice;
const balance = await client.getBalance({ address: account.address });
console.log(`deployer ${account.address}`);
console.log(`balance ${formatEther(balance)} MON, estimated need ${formatEther(needed)} MON`);
if (balance < needed) {
  console.error("Balance is too low for the deployment. Fund the deployer from https://faucet.monad.xyz. No transaction was sent.");
  process.exit(1);
}

// --- deploy ------------------------------------------------------------------------------
for (const step of todo) {
  const { abi, bytecode } = artifact(step.name);
  const args = step.args();
  const data = encodeDeployData({ abi, bytecode, args });
  const gas = ((await client.estimateGas({ account: account.address, data })) * GAS_MARGIN) / 100n;
  const hash = await wallet.deployContract({ abi, bytecode, args, account, gas });
  console.log(`${step.name} submitted ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    console.error(`${step.name} deployment did not succeed. deployment.ts keeps only confirmed contracts.`);
    process.exit(1);
  }
  if (!(await alreadyDeployed(receipt.contractAddress))) {
    console.error(`No bytecode at ${receipt.contractAddress}. deployment.ts keeps only confirmed contracts.`);
    process.exit(1);
  }
  const [addrField, blockField, txField] = FIELDS[step.key];
  record[addrField] = receipt.contractAddress.toLowerCase();
  record[blockField] = Number(receipt.blockNumber);
  record[txField] = hash.toLowerCase();
  writeRecord(record);
  console.log(`${step.name} deployed ${record[addrField]} block ${record[blockField]}`);
}
console.log(`${recordPath.split("/").pop()} updated. Commit it so every build uses these addresses.`);
