// Compiles contracts/AgentFirewallV2.sol on its own so the V1 artifacts (live deployments) are untouched.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "contracts/AgentFirewallV2.sol"), "utf8");
if (/\btx\.origin\b/.test(source) || /\bdelegatecall\b/.test(source)) throw new Error("forbidden pattern");
const input = {
  language: "Solidity",
  sources: { "AgentFirewallV2.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = output.contracts["AgentFirewallV2.sol"].AgentFirewallV2;
const artifact = {
  contractName: "AgentFirewallV2",
  compiler: solc.version(),
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
  deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
};
writeFileSync(join(root, "contracts/out/AgentFirewallV2.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`AgentFirewallV2 compiled (${(c.evm.deployedBytecode.object.length / 2) | 0} bytes runtime)`);
