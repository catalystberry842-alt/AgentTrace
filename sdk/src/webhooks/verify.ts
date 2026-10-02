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
