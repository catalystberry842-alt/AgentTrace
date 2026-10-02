import type { HttpClient } from "../client/http.ts";
import type { Agent, AgentWrite } from "../types/index.ts";

const WRITE = [202, 409];

export class Agents {
  constructor(private readonly http: HttpClient) {}

  create(input: { name: string; description: string; capabilities: string[]; metadataURI?: string; transactionHash?: string }): Promise<AgentWrite> {
    return this.http.send<AgentWrite>("POST", "/api/v1/agents", input, WRITE).then((result) => result.body);
  }

  get(agentId: string): Promise<Agent> {
    return this.http.send<Agent>("GET", `/api/v1/agents/${encodeURIComponent(agentId)}`).then((result) => result.body);
  }

  update(agentId: string, input: { name?: string; description?: string; capabilities?: string[] }): Promise<AgentWrite> {
    return this.http
      .send<AgentWrite>("PATCH", `/api/v1/agents/${encodeURIComponent(agentId)}`, input, WRITE)
      .then((result) => result.body);
  }
}
