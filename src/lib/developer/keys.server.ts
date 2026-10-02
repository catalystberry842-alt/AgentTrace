import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";

export type KeyEnvironment = "development" | "production";

export type ApiKeyRecord = {
  id: string;
  name: string;
  environment: KeyEnvironment;
  prefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type ResolvedKey = {
  keyId: string;
  userId: string;
  environment: KeyEnvironment;
  prefix: string;
};

const NAME = /^[\w .'-]{1,64}$/;

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiKey(
  userId: string,
  name: string,
  environment: KeyEnvironment,
): Promise<{ record: ApiKeyRecord; token: string }> {
  const label = name.trim();
  if (!NAME.test(label)) throw new Error("Key name must be 1–64 characters.");
  if (environment !== "development" && environment !== "production") throw new Error("Unknown key environment.");
  const sql = await getSql();
  const count = await sql<{ total: number }>`
    select count(*)::int as total from api_keys where user_id = ${userId} and revoked_at is null
  `;
  if (Number(count[0]?.total ?? 0) >= 20) throw new Error("Revoke an existing key before creating another.");
  const id = `key_${randomBytes(12).toString("hex")}`;
  const token = `${environment === "production" ? "at_live_" : "at_test_"}${randomBytes(32).toString("base64url")}`;
  const prefix = token.slice(0, 16);
  await sql`
    insert into api_keys (id, user_id, name, environment, prefix, key_hash)
    values (${id}, ${userId}, ${label}, ${environment}, ${prefix}, ${hashApiKey(token)})
  `;
  return {
    token,
    record: { id, name: label, environment, prefix, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null },
  };
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    environment: KeyEnvironment;
    prefix: string;
    created_at: string | null;
    last_used_at: string | null;
    revoked_at: string | null;
  }>`
    select id, name, environment, prefix, created_at::text as created_at,
           last_used_at::text as last_used_at, revoked_at::text as revoked_at
    from api_keys
    where user_id = ${userId}
    order by created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    environment: row.environment,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update api_keys set revoked_at = now()
    where id = ${keyId} and user_id = ${userId} and revoked_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function resolveApiKey(token: string): Promise<ResolvedKey | { revoked: true } | null> {
  if (!token.startsWith("at_test_") && !token.startsWith("at_live_")) return null;
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    user_id: string;
    environment: KeyEnvironment;
    prefix: string;
    key_hash: string;
    revoked_at: string | null;
    expires_at: string | null;
  }>`
    select id, user_id, environment, prefix, key_hash, revoked_at::text as revoked_at, expires_at::text as expires_at
    from api_keys
    where key_hash = ${hashApiKey(token)}
  `;
  const row = rows[0];
  if (!row) return null;
  const computed = Buffer.from(hashApiKey(token));
  const stored = Buffer.from(row.key_hash);
  if (computed.length !== stored.length || !timingSafeEqual(computed, stored)) return null;
  if (row.revoked_at) return { revoked: true };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return { revoked: true };
  await sql`update api_keys set last_used_at = now() where id = ${row.id}`;
  return { keyId: row.id, userId: row.user_id, environment: row.environment, prefix: row.prefix };
}
