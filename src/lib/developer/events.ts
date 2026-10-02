export const WEBHOOK_EVENTS = [
  "execution.executed",
  "proof.verified",
  "proof.unverifiable",
  "outcome.verified",
  "outcome.failed",
  "outcome.unverifiable",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
