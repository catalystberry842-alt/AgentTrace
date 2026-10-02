import { AgentTraceError } from "../errors/error.ts";

type ErrorResponse = { error?: { code?: string; message?: string } };

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async send<T>(method: string, path: string, body?: unknown, accept: number[] = []): Promise<{ status: number; body: T }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: T | ErrorResponse = {} as T;
    if (text) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        throw new AgentTraceError("INVALID_REQUEST", "The API did not return JSON.", response.status);
      }
    }
    if (!response.ok && !accept.includes(response.status)) {
      const error = parsed as ErrorResponse;
      throw new AgentTraceError(
        error.error?.code ?? "EXECUTION_FAILED",
        error.error?.message ?? "The request failed.",
        response.status,
      );
    }
    return { status: response.status, body: parsed as T };
  }
}

export function resolveBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl && baseUrl.trim()) return baseUrl.trim();
  if (typeof window !== "undefined" && typeof window.location?.origin === "string") return window.location.origin;
  throw new AgentTraceError("INVALID_REQUEST", "baseUrl is required when the SDK runs outside the browser.", 400);
}
