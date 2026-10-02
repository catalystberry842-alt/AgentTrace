import type { HttpClient } from "../client/http.ts";
import type { Outcome, OutcomeExpectation } from "../types/index.ts";

export class Outcomes {
  constructor(private readonly http: HttpClient) {}

  get(executionId: string): Promise<{ executionId: string; outcomes: Array<Omit<Outcome, "executionId"> & { verifiedAt: string | null }> }> {
    return this.http
      .send<{ executionId: string; outcomes: Array<Omit<Outcome, "executionId"> & { verifiedAt: string | null }> }>(
        "GET",
        `/api/v1/outcomes/${encodeURIComponent(executionId)}`,
      )
      .then((result) => result.body);
  }

  verify(input: { executionId: string; expectation: OutcomeExpectation }): Promise<Outcome> {
    return this.http
      .send<Outcome>("POST", `/api/v1/outcomes/${encodeURIComponent(input.executionId)}/verify`, { expectation: input.expectation })
      .then((result) => result.body);
  }
}
