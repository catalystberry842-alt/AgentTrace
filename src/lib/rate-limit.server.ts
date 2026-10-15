import { getRequest } from "@tanstack/react-start/server";

/**
 * Best-effort fixed-window limiter for public endpoints that do chain work (RPC reads, indexing).
 * Per server instance, keyed by client IP. It caps abuse from one client; it is not a global quota.
 */
const windows = new Map<string, { start: number; count: number }>();

export class RateLimitedError extends Error {
  constructor() {
    super("Too many requests. Try again in a minute.");
    this.name = "RateLimitedError";
  }
}

export function clientIp(request: Request | null | undefined): string {
  const fwd = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || request?.headers.get("x-real-ip") || "unknown";
}

export function takeToken(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/** Throw RateLimitedError when the current request's IP exceeded `limit` calls per minute for `bucket`. */
export function enforceRateLimit(bucket: string, limit: number): void {
  let request: Request | null = null;
  try {
    request = getRequest() ?? null;
  } catch {
    request = null;
  }
  if (!takeToken(`${bucket}:${clientIp(request)}`, limit)) throw new RateLimitedError();
}
