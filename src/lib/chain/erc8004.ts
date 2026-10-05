import { encodeAbiParameters, parseAbi } from "viem";
import { MONAD } from "@/lib/chain/network";

/**
 * ERC-8004 (Trustless Agents) registries. Deterministic CREATE2 addresses published by the
 * reference deployment (github.com/erc-8004/erc-8004-contracts), live on Monad testnet and mainnet.
 */
const REGISTRIES = {
  10143: {
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
  },
  143: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
  },
} as const;

export const erc8004 = REGISTRIES[MONAD.chainId as 10143 | 143];

/** `{namespace}:{chainId}:{identityRegistry}` as used in ERC-8004 registration files. */
export const erc8004AgentRegistry = `eip155:${MONAD.chainId}:${erc8004.identity}`;

/** Metadata key on the ERC-8004 identity that points back to the AgentTrace agent. */
export const AGENTTRACE_METADATA_KEY = "agenttrace";
/** Validation tag for receipt-verified, anchored executions. */
export const VALIDATION_TAG = "agenttrace-execution";
/** Reputation tag1 for protocol outcomes checked by AgentTrace. */
export const OUTCOME_TAG = "agenttrace-outcome";

/** abi.encode(chainId, AgentRegistry address, AgentTrace agent id). */
export function agentTraceLinkValue(registry: `0x${string}`, agentId: string | bigint): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [BigInt(MONAD.chainId), registry, BigInt(agentId)],
  );
}

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const validationRegistryAbi = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
  "function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint64 count, uint8 avgResponse)",
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
]);

export const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
]);

export type Erc8004Status = {
  registries: typeof erc8004;
  agentRegistry: string;
  agentTraceRegistry: string | null;
  validator: string | null;
  link: { erc8004Id: string; owner: string } | null;
  validation: { count: number; average: number } | null;
  outcomes: { count: number; average: number | null } | null;
  /** Recent ERC-8004 events for this agent from the AgentTrace verifier, via Envio HyperSync (null when not configured). */
  activity?: Array<{ kind: "validation" | "feedback"; txHash: string; blockNumber: number; timestamp: number | null; score: number | null }> | null;
};
