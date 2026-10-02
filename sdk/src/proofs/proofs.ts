import { AgentTraceError } from "../errors/error.ts";
import type { HttpClient } from "../client/http.ts";
import type { Proof } from "../types/index.ts";

export class Proofs {
  constructor(private readonly http: HttpClient) {}

  get(executionId: string): Promise<Proof> {
    return this.http.send<Proof>("GET", `/api/v1/proofs/${encodeURIComponent(executionId)}`).then((result) => result.body);
  }

  verify(executionId: string): Promise<Proof> {
    return this.http.send<Proof>("POST", `/api/v1/proofs/${encodeURIComponent(executionId)}/verify`).then((result) => result.body);
  }

  async waitForVerification(executionId: string, options?: { timeoutMs?: number }): Promise<Proof> {
    const timeout = Math.min(120_000, Math.max(1_000, options?.timeoutMs ?? 30_000));
    const started = Date.now();
    let delay = 1_000;
    let verifies = 0;
    while (Date.now() - started < timeout) {
      const proof = verifies < 4 ? await this.verify(executionId) : await this.get(executionId);
      verifies += 1;
      if (proof.status === "receipt_verified" || proof.status === "unverifiable") return proof;
      const remaining = timeout - (Date.now() - started);
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
      delay = Math.min(5_000, Math.floor(delay * 1.5));
    }
    throw new AgentTraceError(
      "PROOF_TIMEOUT",
      "Verification did not finish before the timeout. The proof was not marked verified.",
      408,
    );
  }
}
