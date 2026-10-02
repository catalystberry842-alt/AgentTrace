import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { apiError } from "@/lib/developer/errors";
import { resolveApiKey, type ResolvedKey } from "@/lib/developer/keys.server";
import { ANON_LIMIT, consumeRate, KEY_LIMIT, type RateResult } from "@/lib/developer/rate-limit.server";

export type ApiContext = { principal: ResolvedKey | null; rate: RateResult };

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "local";
  return ip.slice(0, 64) || "local";
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export async function withApi(
  request: Request,
  mode: "required" | "optional",
  run: (ctx: ApiContext) => Promise<Response>,
): Promise<Response> {
  if (new URL(request.url).searchParams.has("api_key")) {
    return finish(request, null, apiError(400, "INVALID_REQUEST", "API keys are not accepted in the query string."));
  }
  const token = bearer(request);
  let principal: ResolvedKey | null = null;
  if (token) {
    const resolved = await resolveApiKey(token);
    if (!resolved || "revoked" in resolved) {
      const denied = await limit(request, null);
      if (denied.response) return denied.response;
      const message = resolved && "revoked" in resolved ? "This API key has been revoked." : "The API key is not valid.";
      return finish(request, null, stamp(apiError(401, "UNAUTHORIZED", message), denied.rate));
    }
    principal = resolved;
  } else if (mode === "required") {
    const denied = await limit(request, null);
    if (denied.response) return denied.response;
    return finish(
      request,
      null,
      stamp(apiError(401, "UNAUTHORIZED", "Send the API key in the Authorization bearer header."), denied.rate),
    );
  }

  const limited = await limit(request, principal);
  if (limited.response) return limited.response;
  try {
    const response = await run({ principal, rate: limited.rate });
    return finish(request, principal, stamp(response, limited.rate));
  } catch (err) {
    console.error("[agenttrace-api]", err);
    return finish(
      request,
      principal,
      stamp(apiError(500, "EXECUTION_FAILED", "The request could not be completed."), limited.rate),
    );
  }
}

async function limit(
  request: Request,
  principal: ResolvedKey | null,
): Promise<{ rate: RateResult; response?: Response }> {
  const rate = await consumeRate(principal ? `key:${principal.keyId}` : `ip:${clientIp(request)}`, principal ? KEY_LIMIT : ANON_LIMIT);
  if (rate.allowed) return { rate };
  const response = apiError(429, "RATE_LIMITED", "Rate limit exceeded.");
  response.headers.set("retry-after", String(rate.retryAfter));
  return { rate, response: await finish(request, principal, stamp(response, rate)) };
}

function stamp(response: Response, rate: RateResult): Response {
  const headers = new Headers(response.headers);
  headers.set("x-ratelimit-limit", String(rate.limit));
  headers.set("x-ratelimit-remaining", String(rate.remaining));
  if (!headers.has("retry-after") && !rate.allowed) headers.set("retry-after", String(rate.retryAfter));
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

async function finish(request: Request, principal: ResolvedKey | null, response: Response): Promise<Response> {
  try {
    const sql = await getSql();
    const url = new URL(request.url);
    await sql`
      insert into api_requests (id, key_id, user_id, method, path, status)
      values (
        ${`req_${randomBytes(8).toString("hex")}`},
        ${principal?.keyId ?? null},
        ${principal?.userId ?? null},
        ${request.method},
        ${url.pathname},
        ${response.status}
      )
    `;
  } catch (err) {
    console.error("[agenttrace-usage]", err);
  }
  return response;
}
