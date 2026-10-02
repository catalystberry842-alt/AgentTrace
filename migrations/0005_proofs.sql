-- Proof records are derived from indexed AgentAction rows plus an independent receipt check.
-- Replaying an AgentAction must not duplicate a proof or reset a completed verification.

create table if not exists execution_proofs (
  chain_id integer not null,
  proof_id text not null,
  execution_id text not null,
  agent_id text not null,
  firewall_id text not null,
  executor text not null,
  tx_hash text not null,
  block_number bigint not null,
  block_timestamp timestamptz,
  target text not null,
  function_selector text not null,
  value text not null,
  calldata_hash text not null,
  proof_hash text,
  verification_status text not null,
  verification_method text,
  verified_at timestamptz,
  anchored boolean not null default false,
  anchor_tx_hash text,
  anchor_block_number bigint,
  attempt_count integer not null default 0,
  permanent boolean not null default false,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, execution_id),
  unique (chain_id, proof_id),
  constraint execution_proofs_status_chk check (
    verification_status in (
      'executed',
      'requested',
      'receipt_verified',
      'unverifiable',
      'temporary_error'
    )
  )
);

create index if not exists execution_proofs_agent_idx
  on execution_proofs (chain_id, agent_id, created_at desc);

create index if not exists execution_proofs_firewall_idx
  on execution_proofs (chain_id, firewall_id, created_at desc);

create index if not exists execution_proofs_status_idx
  on execution_proofs (chain_id, verification_status, anchored);

create table if not exists verification_checks (
  chain_id integer not null,
  execution_id text not null,
  check_name text not null,
  passed boolean not null,
  details text not null default '',
  verified_at timestamptz,
  primary key (chain_id, execution_id, check_name)
);
