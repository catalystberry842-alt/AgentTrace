-- Outcome records and nothing else. Reputation is not stored.
-- Counts are derived on read from firewall_actions, execution_proofs, and this table.
-- Replaying those rows must reproduce the same counts. There is no score column.

create table if not exists execution_outcomes (
  chain_id integer not null,
  outcome_id text not null,
  execution_id text not null,
  agent_id text not null,
  status text not null,
  expected text not null default '',
  observed text not null default '',
  evidence text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  primary key (chain_id, outcome_id),
  constraint execution_outcomes_status_chk check (
    status in ('verified', 'failed', 'unverifiable')
  )
);

create index if not exists execution_outcomes_agent_idx
  on execution_outcomes (chain_id, agent_id, created_at desc);

create index if not exists execution_outcomes_execution_idx
  on execution_outcomes (chain_id, execution_id);
