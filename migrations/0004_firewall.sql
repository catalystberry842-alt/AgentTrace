-- Firewall indexer. Derived from AgentFirewall events. Rebuildable by replaying logs in order.
-- firewall_intents are off-chain preparation records. They are not firewalls.

create table if not exists indexed_firewalls (
  chain_id integer not null,
  firewall_id text not null,
  agent_id text not null,
  owner text not null,
  executor text not null,
  active boolean not null,
  paused boolean not null,
  created_at timestamptz,
  execution_nonce text not null default '0',
  allow_value_transfer boolean not null,
  max_value_per_tx text not null,
  max_value_per_period text not null,
  spent_in_period text not null default '0',
  period_start_unix text not null default '0',
  period_duration text not null,
  creation_tx_hash text,
  updated_at timestamptz not null default now(),
  primary key (chain_id, firewall_id)
);

create index if not exists indexed_firewalls_agent_idx
  on indexed_firewalls (chain_id, agent_id);

create table if not exists firewall_targets (
  chain_id integer not null,
  firewall_id text not null,
  target text not null,
  name text not null,
  active boolean not null,
  primary key (chain_id, firewall_id, target)
);

create table if not exists firewall_functions (
  chain_id integer not null,
  firewall_id text not null,
  target text not null,
  selector text not null,
  active boolean not null,
  primary key (chain_id, firewall_id, target, selector)
);

create table if not exists firewall_actions (
  chain_id integer not null,
  execution_id text not null,
  firewall_id text not null,
  agent_id text not null,
  executor text not null,
  target text not null,
  selector text not null,
  value text not null,
  execution_nonce text not null,
  calldata_hash text not null,
  executed_at timestamptz,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  primary key (chain_id, execution_id),
  unique (chain_id, tx_hash, log_index)
);

create index if not exists firewall_actions_agent_idx
  on firewall_actions (chain_id, agent_id, block_number, log_index);

create index if not exists firewall_actions_firewall_idx
  on firewall_actions (chain_id, firewall_id, block_number, log_index);

create table if not exists firewall_intents (
  id text primary key,
  user_id text not null,
  agent_id text not null,
  executor text not null,
  allow_value_transfer boolean not null,
  max_value_per_tx text not null,
  max_value_per_period text not null,
  period_duration text not null,
  status text not null,
  tx_hash text,
  chain_firewall_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint firewall_intents_status_chk check (status in ('pending', 'active', 'failed'))
);

create unique index if not exists firewall_intents_tx_idx
  on firewall_intents (tx_hash)
  where tx_hash is not null;

create index if not exists firewall_intents_user_idx
  on firewall_intents (user_id, created_at desc);
