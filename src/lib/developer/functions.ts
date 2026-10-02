import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { createApiKey, listApiKeys, revokeApiKey, type KeyEnvironment } from "@/lib/developer/keys.server";
import {
  createWebhook,
  disableWebhook,
  listWebhooks,
  parseWebhookEvents,
  parseWebhookUrl,
  WEBHOOK_EVENTS,
} from "@/lib/developer/webhooks.server";

export const listDeveloperKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return { keys: await listApiKeys(context.userId) };
  });

export const createDeveloperKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; environment: KeyEnvironment }) => input)
  .handler(async ({ context, data }) => {
    const created = await createApiKey(context.userId, data.name, data.environment);
    return { key: created.record, token: created.token };
  });

export const revokeDeveloperKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((keyId: string) => keyId)
  .handler(async ({ context, data }) => {
    return { revoked: await revokeApiKey(context.userId, data) };
  });

export const listDeveloperWebhooks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return { webhooks: await listWebhooks(context.userId), events: WEBHOOK_EVENTS };
  });

export const createDeveloperWebhook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { url: string; events: string[] }) => input)
  .handler(async ({ context, data }) => {
    const url = parseWebhookUrl(data.url);
    if (!url) throw new Error("Webhook URL must be https, or http on localhost.");
    const events = parseWebhookEvents(data.events);
    if (!events) throw new Error("Choose at least one supported event.");
    const created = await createWebhook(context.userId, url, events);
    return { webhook: created.record, secret: created.secret };
  });

export const disableDeveloperWebhook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((webhookId: string) => webhookId)
  .handler(async ({ context, data }) => {
    return { disabled: await disableWebhook(context.userId, data) };
  });

export const getDeveloperUsage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const requests = await sql<{ total: number; succeeded: number; failed: number }>`
      select count(*)::int as total,
             count(*) filter (where status < 400)::int as succeeded,
             count(*) filter (where status >= 400)::int as failed
      from api_requests
      where user_id = ${context.userId}
    `;
    const deliveries = await sql<{ total: number; delivered: number; failed: number }>`
      select count(*)::int as total,
             count(*) filter (where d.status = 'delivered')::int as delivered,
             count(*) filter (where d.status = 'failed')::int as failed
      from webhook_deliveries d
      join webhooks w on w.id = d.webhook_id
      where w.user_id = ${context.userId}
    `;
    return {
      requests: Number(requests[0]?.total ?? 0),
      succeeded: Number(requests[0]?.succeeded ?? 0),
      failed: Number(requests[0]?.failed ?? 0),
      deliveries: Number(deliveries[0]?.total ?? 0),
      delivered: Number(deliveries[0]?.delivered ?? 0),
      deliveryFailed: Number(deliveries[0]?.failed ?? 0),
    };
  });
