export class AgentTraceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AgentTraceError";
    this.code = code;
    this.status = status;
  }
}
