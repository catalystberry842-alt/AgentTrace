export const CAPABILITIES = [
  "Trading",
  "DeFi",
  "Payments",
  "Yield",
  "Research",
  "Data",
  "Social",
  "Gaming",
  "Other",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type IntentStatus = "draft" | "pending" | "active" | "inactive" | "failed";

export type IndexedAgent = {
  agentId: string;
  owner: string;
  name: string;
  description: string;
  metadataURI: string;
  capabilities: string[];
  capabilityBits: string | null;
  registeredAt: string | null;
  registeredBlock: number | null;
  registrationLogIndex: number | null;
  active: boolean;
  txHash: string | null;
  lastUpdateTxHash: string | null;
  deactivationTxHash: string | null;
};

export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

export type AgentEvent = {
  event: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  args: { [key: string]: JsonValue };
};

export type RegistrationIntent = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  metadataURI: string;
  ownerAddress: string | null;
  status: IntentStatus;
  txHash: string | null;
  chainAgentId: string | null;
  error: string | null;
  createdAt: string;
};

export type IndexerStatus =
  | { status: "unconfigured"; detail: string }
  | { status: "ok"; lastScannedBlock: number; latestBlock: number }
  | { status: "error"; detail: string };

export type ExecutionRecord = {
  id: string;
  agentId: string;
  timestamp: string;
  action: string;
  target: string;
  value: string;
  txHash: string;
  proofId: string | null;
  proofStatus?: string | null;
};

export type ProofStatus = "executed" | "requested" | "receipt_verified" | "unverifiable" | "temporary_error";

export type VerificationCheck = {
  name: string;
  passed: boolean;
  details: string;
};

export type ProofRecord = {
  proofId: string;
  executionId: string;
  agentId: string;
  agentName: string;
  firewallId: string;
  firewallStatus: string | null;
  executor: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: string | null;
  target: string;
  functionSelector: string;
  value: string;
  calldataHash: string;
  proofHash: string | null;
  verificationStatus: ProofStatus;
  verificationMethod: string | null;
  verifiedAt: string | null;
  anchored: boolean;
  anchorTxHash: string | null;
  anchorBlockNumber: number | null;
  createdAt: string | null;
  checks: VerificationCheck[];
  lastError: string | null;
};

export type FirewallTarget = {
  target: string;
  name: string;
  active: boolean;
};

export type FirewallFunctionRule = {
  target: string;
  selector: string;
  active: boolean;
};

export type FirewallAction = {
  executionId: string;
  firewallId: string;
  agentId: string;
  executor: string;
  target: string;
  selector: string;
  value: string;
  executionNonce: string;
  calldataHash: string;
  timestamp: string | null;
  txHash: string;
  blockNumber: number;
  proofStatus: string | null;
  anchored: boolean;
};

export type FirewallRecord = {
  id: string;
  agentId: string;
  agentName: string;
  owner: string;
  executor: string;
  active: boolean;
  paused: boolean;
  status: "active" | "paused" | "inactive";
  createdAt: string | null;
  executionNonce: string;
  allowValueTransfer: boolean;
  maxValuePerTransaction: string;
  maxValuePerPeriod: string;
  spentInPeriod: string;
  periodStartUnix: string;
  periodDuration: string;
  creationTxHash: string | null;
  allowedTargets: FirewallTarget[];
  allowedFunctions: FirewallFunctionRule[];
};

export type FirewallIntentStatus = "pending" | "active" | "failed";

export type FirewallIntent = {
  id: string;
  agentId: string;
  executor: string;
  allowValueTransfer: boolean;
  maxValuePerTransaction: string;
  maxValuePerPeriod: string;
  periodDuration: string;
  status: FirewallIntentStatus;
  txHash: string | null;
  chainFirewallId: string | null;
  error: string | null;
  createdAt: string;
};

export type OutcomeStatus = "verified" | "failed" | "unverifiable";

export type OutcomeRecord = {
  outcomeId: string;
  executionId: string;
  agentId: string;
  status: OutcomeStatus;
  expected: string;
  observed: string;
  evidence: string;
  reason: string;
  createdAt: string | null;
  verifiedAt: string | null;
};

export type HistoryCategory = "Identity" | "Permissions" | "Execution" | "Proof" | "Outcome";

export type HistoryEntry = {
  id: string;
  at: string | null;
  category: HistoryCategory;
  label: string;
  href: string;
};

export type AgentReputation = {
  agentId: string;
  totalExecutions: number;
  verifiedExecutions: number;
  verifiedOutcomes: number;
  failedOutcomes: number;
  unverifiableOutcomes: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  updatedAt: string;
  links: {
    executions: string;
    proofs: string;
    outcomes: string;
  };
};

export type HistoryFlag = {
  agentId: string;
  verifiedExecutions: number;
  verifiedOutcomes: number;
};

export type AgentActivityItem = {
  executionId: string;
  agentId: string;
  selector: string;
  target: string;
  value: string;
  txHash: string;
  timestamp: string | null;
  proofStatus: string | null;
  anchored: boolean;
  verified: boolean;
};

export type ChainStatus = {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  registry: string | null;
  deployBlock: number | null;
  deployTx: string | null;
  firewall: string | null;
  firewallDeployBlock: number | null;
  firewallDeployTx: string | null;
  rpcOk: boolean;
  chainIdSeen: number | null;
  rpcError: string | null;
  indexedAgents: number;
  indexedFirewalls: number;
  indexedProofs: number;
  proofAnchor: string | null;
  demoProtocol: string | null;
  lastScannedBlock: number | null;
};
