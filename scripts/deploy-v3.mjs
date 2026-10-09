/**
 * Deploy AgentFirewallV3 (per-agent vaults, session executors, one-transaction setup) and
 * AgentProofQuorum (multi-verifier anchoring with disputes) next to the existing AgentRegistry.
 *
 *   MONAD_DEPLOYER_PRIVATE_KEY=0x... \
 *   AGENT_PROOF_VERIFIERS=0xVerifierA,0xVerifierB AGENT_PROOF_THRESHOLD=2 \
 *   node scripts/deploy-v3.mjs [--mainnet --confirm-mainnet] [--smoke]
 *
 * - AGENT_PROOF_VERIFIERS defaults to the current AgentProof verifier (0x77a5…0D85) alone, threshold 1;
 *   add a second, independently operated key (see scripts/second-verifier.mjs) and set threshold 2.
 * - --smoke runs one end-to-end check on the new firewall: register agent -> ONE setup transaction
 *   (firewall + vault + session key + DemoProtocol.deposit permission + gas stipend) -> the session
 *   key executes deposit(agentId, 100) -> prints the execution id for the verifier.
 * - Resumable: contracts/deployments/v3-<network>.json is written after each confirmed transaction.
 * - Monad charges the gas limit, so every transaction uses estimateGas * 1.15.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeDeployData, encodeFunctionData,
  formatEther, http, parseAbi, toFunctionSelector,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = join(import.meta.dirname, "..");
const MAINNET = process.argv.includes("--mainnet");
if (MAINNET && !process.argv.includes("--confirm-mainnet")) {
  console.error("Mainnet deploys spend real MON. Re-run with --confirm-mainnet. No transaction was sent.");
  process.exit(1);
}
const CHAIN_ID = MAINNET ? 143 : 10143;
const NAME = MAINNET ? "Monad mainnet" : "Monad testnet";
const EXPLORER = MAINNET ? "https://monadvision.com" : "https://testnet.monadvision.com";
const RPC = process.env.MONAD_DEPLOY_RPC_URL?.trim() || (MAINNET ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
const REGISTRY = "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e"; // same address on both networks
const DEMO = "0x1664be58ee54af91c756428f466bad6e4f9911c3";
const CURRENT_VERIFIER = "0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85";

const key = process.env.MONAD_DEPLOYER_PRIVATE_KEY?.trim();
if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) {
  console.error("MONAD_DEPLOYER_PRIVATE_KEY is not set to a 32-byte hex key. No transaction was sent.");
  process.exit(1);
}
const verifiers = (process.env.AGENT_PROOF_VERIFIERS?.trim() || CURRENT_VERIFIER).split(",").map((v) => v.trim());
for (const v of verifiers) if (!/^0x[a-fA-F0-9]{40}$/.test(v)) throw new Error(`Bad verifier address ${v}`);
const threshold = BigInt(process.env.AGENT_PROOF_THRESHOLD?.trim() || String(Math.min(2, verifiers.length)));

const chain = defineChain({ id: CHAIN_ID, name: NAME, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount(key);
const transport = http(RPC, { timeout: 30_000, retryCount: 3 });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport, account });
if ((await pub.getChainId()) !== CHAIN_ID) throw new Error(`RPC is not ${NAME}`);

const art = (n) => JSON.parse(readFileSync(join(root, `contracts/out/${n}.json`), "utf8"));
const fwArt = art("AgentFirewallV3");
const qArt = art("AgentProofQuorum");
const registryAbi = art("AgentRegistry").abi;
const demoAbi = parseAbi(["function deposit(uint256 agentId, uint256 amount)"]);

const recordPath = join(root, `contracts/deployments/v3-${MAINNET ? "mainnet" : "testnet"}.json`);
const rec = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : { chainId: CHAIN_ID, network: NAME, registry: REGISTRY, demoProtocol: DEMO, txs: {} };
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
console.log(`${NAME}: sender ${account.address}, balance ${formatEther(await pub.getBalance({ address: account.address }))} MON`);

async function send(label, request) {
  const gas = await pub.estimateGas({ account, ...request });
  const hash = await wallet.sendTransaction({ ...request, gas: (gas * 115n) / 100n });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${EXPLORER}/tx/${hash}`);
  rec.txs[label] = hash;
  save();
  console.log(`${label}: ${EXPLORER}/tx/${hash}`);
  return receipt;
}

if (!rec.agentFirewallV3) {
  const r = await send("deployAgentFirewallV3", { data: encodeDeployData({ abi: fwArt.abi, bytecode: fwArt.bytecode, args: [REGISTRY] }) });
  rec.agentFirewallV3 = r.contractAddress.toLowerCase();
  rec.agentFirewallV3DeployBlock = Number(r.blockNumber);
  save();
}
if (!rec.agentProofQuorum) {
  const r = await send("deployAgentProofQuorum", { data: encodeDeployData({ abi: qArt.abi, bytecode: qArt.bytecode, args: [verifiers, threshold] }) });
  rec.agentProofQuorum = r.contractAddress.toLowerCase();
  rec.agentProofQuorumDeployBlock = Number(r.blockNumber);
  rec.quorum = { verifiers, threshold: Number(threshold) };
  save();
}
console.log(`AgentFirewallV3 ${rec.agentFirewallV3}\nAgentProofQuorum ${rec.agentProofQuorum} (${threshold} of ${verifiers.length})`);

if (process.argv.includes("--smoke") && !rec.smoke) {
  const reg = await send("registerAgent", {
    to: REGISTRY,
    data: encodeFunctionData({ abi: registryAbi, functionName: "registerAgent", args: ["V3 Vault Agent", "Per-agent vault and session key via AgentFirewallV3.", "", 1n] }),
  });
  const agentId = reg.logs
    .flatMap((l) => { try { return [decodeEventLog({ abi: registryAbi, ...l })]; } catch { return []; } })
    .find((e) => e.eventName === "AgentRegistered").args.agentId;
  const sessionKey = generatePrivateKey();
  const session = privateKeyToAccount(sessionKey);
  const gasPrice = await pub.getGasPrice();
  const stipend = gasPrice * 400_000n;
  const setup = await send("createFirewallWithPermissions", {
    to: rec.agentFirewallV3,
    value: stipend,
    data: encodeFunctionData({
      abi: fwArt.abi,
      functionName: "createFirewallWithPermissions",
      args: [agentId, session.address, BigInt(Math.floor(Date.now() / 1000) + 86_400), false, 0n, 0n, 86_400n,
        [{ target: DEMO, name: "AgentTrace Demo Protocol", selectors: [toFunctionSelector("deposit(uint256,uint256)")] }]],
    }),
  });
  const created = setup.logs
    .flatMap((l) => { try { return [decodeEventLog({ abi: fwArt.abi, ...l })]; } catch { return []; } });
  const firewallId = created.find((e) => e.eventName === "FirewallCreated").args.firewallId;
  const vault = created.find((e) => e.eventName === "VaultCreated").args.vault;
  const sessionWallet = createWalletClient({ chain, transport, account: session });
  const data = encodeFunctionData({ abi: fwArt.abi, functionName: "execute", args: [firewallId, DEMO, 0n, encodeFunctionData({ abi: demoAbi, functionName: "deposit", args: [agentId, 100n] })] });
  const gas = await pub.estimateGas({ account: session, to: rec.agentFirewallV3, data });
  const hash = await sessionWallet.sendTransaction({ to: rec.agentFirewallV3, data, gas: (gas * 115n) / 100n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const action = receipt.logs
    .flatMap((l) => { try { return [decodeEventLog({ abi: fwArt.abi, ...l })]; } catch { return []; } })
    .find((e) => e.eventName === "AgentAction");
  rec.txs.sessionExecuteDeposit100 = hash;
  rec.smoke = { agentId: String(agentId), firewallId: String(firewallId), vault, sessionExecutor: session.address, executionId: action.args.executionId };
  save();
  console.log(`session key executed: ${EXPLORER}/tx/${hash}\nexecution ${action.args.executionId} (vault ${vault})`);
}
