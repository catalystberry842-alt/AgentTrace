import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 of the raw JSON body. Header value is `sha256=<hex>`. */
export function signPayload(secret: string, payload: string): string {
  const hex = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${hex}`;
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(secret, payload);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature.trim());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** HMAC-SHA256 over `${timestamp}.${payload}`. Header `X-AgentTrace-Signature-V2: t=<ts>,v1=<hex>`. */
export function signPayloadWithTimestamp(secret: string, payload: string, timestamp: number): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${hex}`;
}

/**
 * Verify an `X-AgentTrace-Signature-V2` header and reject deliveries older (or further in the
 * future) than toleranceSeconds, so a captured delivery cannot be replayed later. Receivers should
 * also de-duplicate on the event `id` inside the body.
 */
export function verifyWebhook(
  payload: string,
  signatureV2: string,
  secret: string,
  { toleranceSeconds = 300, now = Math.floor(Date.now() / 1000) }: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const parts = Object.fromEntries(
    signatureV2.split(",").map((kv) => {
      const at = kv.indexOf("=");
      return [kv.slice(0, at).trim(), kv.slice(at + 1).trim()];
    }),
  );
  const ts = Number(parts.t);
  if (!Number.isInteger(ts) || !parts.v1) return false;
  if (Math.abs(now - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayloadWithTimestamp(secret, payload, ts));
  const given = Buffer.from(`t=${parts.t},v1=${parts.v1}`);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
