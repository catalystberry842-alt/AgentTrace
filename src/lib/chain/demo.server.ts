import { getPublicClient } from "@/lib/chain/indexer.server";
import { agentFirewallAbi } from "@/lib/chain/abi";
import { configuredFirewall } from "@/lib/chain/firewall.server";
import { configuredRegistry } from "@/lib/chain/indexer.server";
import { configuredDemoProtocol } from "@/lib/chain/addresses.server";
import { toFunctionSelector } from "viem";

export { configuredDemoProtocol };

const DEPOSIT = toFunctionSelector("deposit(uint256,uint256)");
const SWAP = toFunctionSelector("swap(uint256,uint256,uint256)");
const WITHDRAW = toFunctionSelector("withdraw(uint256,uint256)");

export type DemoChecks = {
  targetAllowed: boolean;
  depositAllowed: boolean;
  swapAllowed: boolean;
  withdrawAllowed: boolean;
  valueTransferDisabled: boolean;
  executor: string | null;
};

export async function readDemoFirewall(firewallId: string): Promise<{
  demoProtocol: `0x${string}` | null;
  registry: `0x${string}` | null;
  firewall: `0x${string}` | null;
  checks: DemoChecks | null;
  error: string | null;
}> {
  const demoProtocol = configuredDemoProtocol();
  const registry = configuredRegistry();
  const firewall = configuredFirewall();
  if (!demoProtocol || !registry || !firewall) {
    return { demoProtocol, registry, firewall, checks: null, error: null };
  }
  if (!/^[1-9]\d*$/.test(firewallId)) {
    return { demoProtocol, registry, firewall, checks: null, error: null };
  }
  try {
    const client = getPublicClient();
    const id = BigInt(firewallId);
    const target = demoProtocol;
    const [targetAllowed, depositAllowed, swapAllowed, withdrawAllowed, record, policy] = await Promise.all([
      client.readContract({
        address: firewall,
        abi: agentFirewallAbi,
        functionName: "isTargetActive",
        args: [id, target],
      }),
      client.readContract({
        address: firewall,
        abi: agentFirewallAbi,
        functionName: "isFunctionAllowed",
        args: [id, target, DEPOSIT],
      }),
      client.readContract({
        address: firewall,
        abi: agentFirewallAbi,
        functionName: "isFunctionAllowed",
        args: [id, target, SWAP],
      }),
      client.readContract({
        address: firewall,
        abi: agentFirewallAbi,
        functionName: "isFunctionAllowed",
        args: [id, target, WITHDRAW],
      }),
      client.readContract({
        address: firewall,
        abi: agentFirewallAbi,
        functionName: "getFirewall",
        args: [id],
      }),
      client.readContract({
        address: firewall,
        abi: agentFirewallAbi,
        functionName: "getPolicy",
        args: [id],
      }),
    ]);
    const executor = typeof record === "object" && record && "executor" in record ? String(record.executor).toLowerCase() : null;
    const valueTransferDisabled = typeof policy === "object" && policy && "allowValueTransfer" in policy ? policy.allowValueTransfer === false : false;
    return {
      demoProtocol,
      registry,
      firewall,
      checks: {
        targetAllowed: Boolean(targetAllowed),
        depositAllowed: Boolean(depositAllowed),
        swapAllowed: Boolean(swapAllowed),
        withdrawAllowed: Boolean(withdrawAllowed),
        valueTransferDisabled,
        executor: executor && /^0x[a-fA-F0-9]{40}$/.test(executor) ? executor : null,
      },
      error: null,
    };
  } catch (err) {
    return {
      demoProtocol,
      registry,
      firewall,
      checks: null,
      error: err instanceof Error ? err.message : "The firewall could not be read.",
    };
  }
}
