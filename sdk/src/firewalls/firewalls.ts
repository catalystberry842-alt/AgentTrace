import type { HttpClient } from "../client/http.ts";
import type { ExecutionWrite, Firewall, FirewallWrite } from "../types/index.ts";

const WRITE = [202, 409];

export class Firewalls {
  readonly targets: { allow: (input: { firewallId: string; target: string }) => Promise<FirewallWrite> };
  readonly functions: { allow: (input: { firewallId: string; target: string; selector: string }) => Promise<FirewallWrite> };

  constructor(private readonly http: HttpClient) {
    this.targets = {
      allow: (input) =>
        this.http
          .send<FirewallWrite>("POST", `/api/v1/firewalls/${encodeURIComponent(input.firewallId)}/targets`, { target: input.target }, [400, 404, 409])
          .then((result) => result.body),
    };
    this.functions = {
      allow: (input) =>
        this.http
          .send<FirewallWrite>(
            "POST",
            `/api/v1/firewalls/${encodeURIComponent(input.firewallId)}/functions`,
            { target: input.target, selector: input.selector },
            [400, 404, 409],
          )
          .then((result) => result.body),
    };
  }

  create(input: {
    agentId: string;
    executor: string;
    policy: {
      allowValueTransfer: boolean;
      maxValuePerTransaction: string;
      maxValuePerPeriod: string;
      periodDuration: string;
    };
    transactionHash?: string;
  }): Promise<FirewallWrite> {
    return this.http.send<FirewallWrite>("POST", "/api/v1/firewalls", input, WRITE).then((result) => result.body);
  }

  get(firewallId: string): Promise<Firewall> {
    return this.http.send<Firewall>("GET", `/api/v1/firewalls/${encodeURIComponent(firewallId)}`).then((result) => result.body);
  }

  execute(input: { firewallId: string; target: string; value: string; data: string }): Promise<ExecutionWrite> {
    return this.http
      .send<ExecutionWrite>("POST", `/api/v1/firewalls/${encodeURIComponent(input.firewallId)}/execute`, input, [400, 403, 404, 409])
      .then((result) => result.body);
  }
}
