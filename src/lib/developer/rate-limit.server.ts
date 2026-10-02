import { getSql } from "@/lib/db";

export const ANON_LIMIT = 60;
export const KEY_LIMIT = 300;

export type RateResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
};

export async function consumeRate(subject: string, limit: number): Promise<RateResult> {
  const sql = await getSql();
  const rows = await sql<{ hits: number; retry_after: number }>`
    insert into api_rate_windows (subject, window_start, hits)
    values (${subject}, date_trunc('minute', now()), 1)
    on conflict (subject, window_start)
    do update set hits = api_rate_windows.hits + 1
    returning hits, greatest(1, ceil(extract(epoch from (window_start + interval '1 minute' - now()))))::int as retry_after
  `;
  const hits = Number(rows[0]?.hits ?? 1);
  const retryAfter = Number(rows[0]?.retry_after ?? 60);
  return {
    allowed: hits <= limit,
    limit,
    remaining: Math.max(0, limit - hits),
    retryAfter,
  };
}
