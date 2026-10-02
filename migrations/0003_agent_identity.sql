-- Identity indexer fields. Derived from AgentRegistered / AgentUpdated / AgentDeactivated.
-- Registration intents use the identity states. They are not onchain agents.

alter table indexed_agents
  add column if not exists registration_log_index integer,
  add column if not exists last_update_tx_hash text,
  add column if not exists deactivation_tx_hash text,
  add column if not exists chain_updated_at timestamptz,
  add column if not exists capability_bits text;

update registration_intents set status = 'draft' where status = 'awaiting_authorization';
update registration_intents set status = 'pending' where status = 'submitted';
update registration_intents set status = 'active' where status = 'registered';
update registration_intents set status = 'failed' where status = 'chain_unavailable';

alter table registration_intents drop constraint if exists registration_intents_status_chk;
alter table registration_intents add constraint registration_intents_status_chk check (
  status in ('draft', 'pending', 'active', 'inactive', 'failed')
);
