import type { HttpClient } from "../client/http.ts";
import type { Execution } from "../types/index.ts";

export class Executions {
  constructor(private readonly http: HttpClient) {}

  get(executionId: string): Promise<Execution> {
    return this.http.send<Execution>("GET", `/api/v1/executions/${encodeURIComponent(executionId)}`).then((result) => result.body);
  }
}
