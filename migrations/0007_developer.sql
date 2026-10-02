-- Developer access. API keys are stored as hashes. Webhook signing secrets stay server-side
-- and are not returned after creation. Request rows are real traffic only.

create table if not exists api_keys (
  id text primary key,
  user_id text not null,
  name text not null,
  environment text not null,
  prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  constraint api_keys_environment_chk check (environment in ('development', 'production'))
);

create index if not exists api_keys_user_idx on api_keys (user_id, created_at desc);

create table if not exists api_requests (
  id text primary key,
  key_id text,
  user_id text,
  method text not null,
  path text not null,
  status integer not null,
  created_at timestamptz not null default now()
);

create index if not exists api_requests_user_idx on api_requests (user_id, created_at desc);

create table if not exists api_rate_windows (
  subject text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (subject, window_start)
);

create table if not exists webhooks (
  id text primary key,
  user_id text not null,
  url text not null,
  signing_secret text not null,
  events text[] not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create index if not exists webhooks_user_idx on webhooks (user_id, created_at desc);

create table if not exists webhook_deliveries (
  id text primary key,
  webhook_id text not null,
  event_id text not null,
  event_type text not null,
  response_status integer,
  status text not null,
  created_at timestamptz not null default now(),
  constraint webhook_deliveries_status_chk check (status in ('delivered', 'failed'))
);

create index if not exists webhook_deliveries_hook_idx on webhook_deliveries (webhook_id, created_at desc);
