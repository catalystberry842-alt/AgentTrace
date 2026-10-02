export type NetworkName = "monad-testnet";

export type ChainStatus = "submitted" | "pending" | "confirmed" | "failed";

export type ApiErrorBody = { code: string; message: string };

export type AgentWrite = {
  agentId: string | null;
  transactionHash: string | null;
  status: ChainStatus;
  error?: ApiErrorBody;
};

export type FirewallWrite = {
  firewallId: string | null;
  transactionHash: string | null;
  status: ChainStatus;
  error?: ApiErrorBody;
};

export type ExecutionWrite = {
  executionId: string | null;
  transactionHash: string | null;
  status: ChainStatus;
  error?: ApiErrorBody;
};

export type Agent = {
  agentId: string;
  name: string;
  description: string;
  capabilities: string[];
  owner: string;
  active: boolean;
  metadataURI: string;
  registeredAt: string | null;
  network: NetworkName;
  chainId: number;
};

export type Firewall = {
  firewallId: string;
  agentId: string;
  owner: string;
  executor: string;
  status: string;
  paused: boolean;
  active: boolean;
  allowValueTransfer: boolean;
  maxValuePerTransaction: string;
  maxValuePerPeriod: string;
  periodDuration: string;
  allowedTargets: { target: string; name: string; active: boolean }[];
  allowedFunctions: { target: string; selector: string; active: boolean }[];
  network: NetworkName;
  chainId: number;
};

export type Execution = {
  executionId: string;
  firewallId: string;
  agentId: string;
  target: string;
  selector: string;
  value: string;
  transactionHash: string;
  blockNumber: number;
  status: "executed";
};

export type VerificationStatus = "executed" | "requested" | "receipt_verified" | "unverifiable" | "temporary_error";

export type Proof = {
  executionId: string;
  agentId: string;
  firewallId: string;
  status: VerificationStatus | string;
  proofHash: string | null;
  transactionHash: string;
  anchored: boolean;
  verificationMethod: string | null;
  verifiedAt: string | null;
};

export type OutcomeStatus = "verified" | "failed" | "unverifiable";

export type Outcome = {
  executionId: string;
  status: OutcomeStatus;
  expected: string;
  observed: string;
  evidence: string;
  reason: string;
  outcomeHash: string;
};

export type OutcomeExpectation =
  | {
      type: "EVENT_EMITTED";
      event: string;
      eventSignature: string;
      conditions?: Record<string, { operator: ">=" | "<=" | ">" | "<" | "==" | "!="; value: string }>;
    }
  | {
      type: "VALUE_CHANGED" | "BALANCE_CHANGED" | "STATE_CHANGED";
      source: "DemoProtocol";
      field: "deposits" | "swapped";
      agentId: string;
      expectedValue: string;
    };

export type AgentTraceOptions = {
  apiKey: string;
  network: NetworkName;
  baseUrl?: string;
};
