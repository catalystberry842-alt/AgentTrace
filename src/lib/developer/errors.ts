export const API_ERROR_CODES = [
  "AGENT_NOT_FOUND",
  "UNAUTHORIZED",
  "FIREWALL_NOT_FOUND",
  "FIREWALL_PAUSED",
  "FIREWALL_INACTIVE",
  "TARGET_NOT_ALLOWED",
  "FUNCTION_NOT_ALLOWED",
  "VALUE_LIMIT_EXCEEDED",
  "EXECUTION_FAILED",
  "EXECUTION_NOT_FOUND",
  "PROOF_NOT_FOUND",
  "PROOF_UNVERIFIABLE",
  "PROOF_TIMEOUT",
  "OUTCOME_UNSUPPORTED",
  "REGISTRY_NOT_DEPLOYED",
  "FIREWALL_NOT_DEPLOYED",
  "CHAIN_WRITE_UNAVAILABLE",
  "CHAIN_UNAVAILABLE",
  "RATE_LIMITED",
  "INVALID_REQUEST",
  "MAINNET_UNAVAILABLE",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function apiError(status: number, code: ApiErrorCode | string, message: string, extra?: Record<string, unknown>): Response {
  return Response.json(
    { error: { code, message }, ...extra },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function apiJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  const next = new Headers(headers);
  next.set("cache-control", "no-store");
  return Response.json(body, { status, headers: next });
}
