import { encodeAbiParameters, keccak256 } from "viem";

/**
 * keccak256(abi.encode(chainId, agentId, firewallId, executionId, executor,
 * transactionHash, blockNumber, target, selector, value, calldataHash)).
 * Field order is fixed. Verification status is not an input: it is the
 * conclusion of these checks, and the same evidence must keep the same hash.
 */
export function computeProofHash(input: {
  chainId: bigint;
  agentId: bigint;
  firewallId: bigint;
  executionId: `0x${string}`;
  executor: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  target: `0x${string}`;
  functionSelector: `0x${string}`;
  value: bigint;
  calldataHash: `0x${string}`;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes4" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        input.chainId,
        input.agentId,
        input.firewallId,
        input.executionId,
        input.executor,
        input.transactionHash,
        input.blockNumber,
        input.target,
        input.functionSelector,
        input.value,
        input.calldataHash,
      ],
    ),
  );
}

export function proofIdFor(chainId: number, executionId: `0x${string}`): `0x${string}` {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [BigInt(chainId), executionId]));
}
