import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/developer/events";
import { signPayload, signPayloadWithTimestamp } from "../../../sdk/src/webhooks/verify.ts";
import { assertDeliverable, parseWebhookUrl } from "@/lib/developer/webhook-url";

export { WEBHOOK_EVENTS, parseWebhookUrl };
export type { WebhookEvent };

export type WebhookRecord = {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: string | null;
  disabledAt: string | null;
};

export function parseWebhookEvents(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const events: WebhookEvent[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !WEBHOOK_EVENTS.includes(item as WebhookEvent)) return null;
    const event = item as WebhookEvent;
    if (!events.includes(event)) events.push(event);
  }
  return events;
}

export async function createWebhook(
  userId: string,
  url: string,
  events: WebhookEvent[],
): Promise<{ record: WebhookRecord; secret: string }> {
  const sql = await getSql();
  const count = await sql<{ total: number }>`
    select count(*)::int as total from webhooks where user_id = ${userId} and disabled_at is null
  `;
  if (Number(count[0]?.total ?? 0) >= 10) throw new Error("Disable a webhook before creating another.");
  const id = `wh_${randomBytes(12).toString("hex")}`;
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  await sql`
    insert into webhooks (id, user_id, url, signing_secret, events)
    values (${id}, ${userId}, ${url}, ${secret}, ${events})
  `;
  return {
    secret,
    record: { id, url, events, createdAt: new Date().toISOString(), disabledAt: null },
  };
}

export async function listWebhooks(userId: string): Promise<WebhookRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    url: string;
    events: WebhookEvent[];
    created_at: string | null;
    disabled_at: string | null;
  }>`
    select id, url, events, created_at::text as created_at, disabled_at::text as disabled_at
    from webhooks
    where user_id = ${userId}
    order by created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    events: row.events,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  }));
}

export async function disableWebhook(userId: string, webhookId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update webhooks set disabled_at = now()
    where id = ${webhookId} and user_id = ${userId} and disabled_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function publishDeveloperEvent(
  type: WebhookEvent,
  data: Record<string, string | number | null>,
): Promise<void> {
  const sql = await getSql();
  const hooks = await sql<{ id: string; url: string; signing_secret: string }>`
    select id, url, signing_secret from webhooks
    where disabled_at is null and ${type} = any(events)
  `;
  await Promise.all(hooks.map((hook) => deliver(hook, type, data)));
}

async function deliver(
  hook: { id: string; url: string; signing_secret: string },
  type: WebhookEvent,
  data: Record<string, string | number | null>,
): Promise<void> {
  const eventId = `evt_${randomBytes(12).toString("hex")}`;
  const payload = JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), data });
  const signature = signPayload(hook.signing_secret, payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let responseStatus: number | null = null;
  let status: "delivered" | "failed" = "failed";
  try {
    await assertDeliverable(hook.url);
    const response = await fetch(hook.url, {
      method: "POST",
      // A redirect could point at an internal address; never follow one.
      redirect: "manual",
      body: payload,
      headers: {
        "content-type": "application/json",
        // Legacy body-only signature, kept so existing receivers keep working.
        "X-AgentTrace-Signature": signature,
        // Replay-resistant: HMAC over `${timestamp}.${body}`; receivers should reject old timestamps.
        "X-AgentTrace-Timestamp": String(timestamp),
        "X-AgentTrace-Signature-V2": signPayloadWithTimestamp(hook.signing_secret, payload, timestamp),
        "X-AgentTrace-Event": type,
      },
      signal: AbortSignal.timeout(4000),
    });
    responseStatus = response.status;
    status = response.ok ? "delivered" : "failed";
  } catch {
    status = "failed";
  }
  try {
    const sql = await getSql();
    await sql`
      insert into webhook_deliveries (id, webhook_id, event_id, event_type, response_status, status)
      values (${`del_${randomBytes(8).toString("hex")}`}, ${hook.id}, ${eventId}, ${type}, ${responseStatus}, ${status})
    `;
  } catch (err) {
    console.error("[agenttrace-webhook]", err);
  }
}
