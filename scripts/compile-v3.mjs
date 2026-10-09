// Compiles the V3 contracts (AgentFirewallV3 + AgentVault, AgentProofQuorum) on their own, so the
// artifacts of live deployments (V1, V2) stay untouched.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";

const root = join(import.meta.dirname, "..");
const files = ["AgentVault.sol", "AgentFirewallV3.sol", "AgentProofQuorum.sol"];
const sources = {};
for (const file of files) {
  const content = readFileSync(join(root, "contracts", file), "utf8");
  if (/\btx\.origin\b/.test(content) || /\bdelegatecall\b/.test(content)) throw new Error(`forbidden pattern in ${file}`);
  sources[file] = { content };
}
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: (path) => {
  try { return { contents: readFileSync(join(root, "contracts", path.replace(/^\.\//, "")), "utf8") }; } catch { return { error: "not found" }; }
} }));
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const [file, name] of [["AgentVault.sol", "AgentVault"], ["AgentFirewallV3.sol", "AgentFirewallV3"], ["AgentProofQuorum.sol", "AgentProofQuorum"]]) {
  const c = output.contracts[file][name];
  const artifact = {
    contractName: name,
    compiler: solc.version(),
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
  };
  writeFileSync(join(root, `contracts/out/${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`${name} compiled (${(c.evm.deployedBytecode.object.length / 2) | 0} bytes runtime)`);
}
