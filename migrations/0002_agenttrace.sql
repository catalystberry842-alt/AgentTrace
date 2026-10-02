-- AgentTrace indexer + registration intents.
-- Indexed rows are derived state and must be rebuildable from chain events.
-- registration_intents are off-chain preparation records. They are not agent identities.

create table if not exists indexer_state (
  chain_id integer not null,
  contract_address text not null,
  last_scanned_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, contract_address)
);

create table if not exists indexed_agents (
  chain_id integer not null,
  agent_id text not null,
  owner text not null,
  name text not null,
  description text not null,
  metadata_uri text not null,
  capabilities jsonb not null,
  registered_at timestamptz,
  registered_block bigint,
  active boolean not null,
  tx_hash text,
  updated_at timestamptz not null default now(),
  primary key (chain_id, agent_id)
);

create index if not exists indexed_agents_owner_idx
  on indexed_agents (chain_id, owner);

create table if not exists indexed_events (
  id bigserial primary key,
  chain_id integer not null,
  agent_id text not null,
  event_name text not null,
  block_number bigint not null,
  tx_hash text not null,
  log_index integer not null,
  payload jsonb not null,
  unique (chain_id, tx_hash, log_index)
);

create index if not exists indexed_events_agent_idx
  on indexed_events (chain_id, agent_id, block_number, log_index);

create table if not exists registration_intents (
  id text primary key,
  user_id text not null,
  name text not null,
  description text not null,
  capabilities jsonb not null,
  metadata_uri text not null default '',
  owner_address text,
  status text not null,
  tx_hash text,
  chain_agent_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_intents_status_chk check (
    status in (
      'chain_unavailable',
      'awaiting_authorization',
      'submitted',
      'registered',
      'failed'
    )
  )
);

create index if not exists registration_intents_user_idx
  on registration_intents (user_id, created_at desc);
