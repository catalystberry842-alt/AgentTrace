import { Agents } from "./agents/agents.ts";
import { resolveBaseUrl, HttpClient } from "./client/http.ts";
import { AgentTraceError } from "./errors/error.ts";
import { Executions } from "./executions/executions.ts";
import { Firewalls } from "./firewalls/firewalls.ts";
import { Outcomes } from "./outcomes/outcomes.ts";
import { Proofs } from "./proofs/proofs.ts";
import type { AgentTraceOptions } from "./types/index.ts";
import { verifySignature } from "./webhooks/verify.ts";

export class AgentTrace {
  readonly agents: Agents;
  readonly firewalls: Firewalls;
  readonly executions: Executions;
  readonly proofs: Proofs;
  readonly outcomes: Outcomes;
  readonly webhooks: { verifySignature: typeof verifySignature };

  constructor(options: AgentTraceOptions) {
    if (options.network !== "monad-testnet") {
      throw new AgentTraceError("MAINNET_UNAVAILABLE", "Monad mainnet is not supported. No request was sent.", 400);
    }
    if (!options.apiKey || options.apiKey.includes("?")) {
      throw new AgentTraceError("UNAUTHORIZED", "An API key is required and must not be placed in a URL.", 401);
    }
    const http = new HttpClient(options.apiKey, resolveBaseUrl(options.baseUrl));
    this.agents = new Agents(http);
    this.firewalls = new Firewalls(http);
    this.executions = new Executions(http);
    this.proofs = new Proofs(http);
    this.outcomes = new Outcomes(http);
    this.webhooks = { verifySignature };
  }
}

export { AgentTraceError, verifySignature };
export type {
  Agent,
  AgentTraceOptions,
  AgentWrite,
  ChainStatus,
  Execution,
  ExecutionWrite,
  Firewall,
  FirewallWrite,
  NetworkName,
  Outcome,
  OutcomeExpectation,
  OutcomeStatus,
  Proof,
  VerificationStatus,
} from "./types/index.ts";
