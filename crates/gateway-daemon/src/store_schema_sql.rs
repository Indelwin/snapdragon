pub(crate) const LEASE_FENCE_MIGRATION: &str = r#"
update gateway_leases
set attempt = coalesce((
  select max(1, cast(json_extract(job.status_json, '$.attempts') as integer))
  from gateway_jobs as job
  where job.id = gateway_leases.job_id
), 1);

update gateway_jobs
set status_json = json_set(
  status_json,
  '$.lease_attempt',
  (
    select lease.attempt
    from gateway_leases as lease
    where lease.job_id = gateway_jobs.id
      and lease.id = json_extract(gateway_jobs.status_json, '$.lease_id')
  )
)
where state = 'running'
  and json_extract(status_json, '$.lease_attempt') is null
  and exists (
    select 1
    from gateway_leases as lease
    where lease.job_id = gateway_jobs.id
      and lease.id = json_extract(gateway_jobs.status_json, '$.lease_id')
  );
"#;

pub(crate) const SCHEMA: &str = r#"
create table if not exists gateway_jobs(
  id text primary key,
  kind text not null,
  queue text not null,
  state text not null,
  priority integer not null default 0,
  status_json text not null,
  updated_at_ms integer not null
);
create index if not exists gateway_jobs_queue_state on gateway_jobs(queue, state, priority, id);

create table if not exists gateway_leases(
  id text primary key,
  job_id text not null,
  worker text not null,
  attempt integer not null,
  acquired_at_ms integer not null,
  expires_at_ms integer not null
);
create index if not exists gateway_leases_expires on gateway_leases(expires_at_ms);

create table if not exists gateway_events(
  id text primary key,
  kind text not null,
  target text,
  state text not null,
  payload_json text not null,
  created_at_ms integer not null,
  updated_at_ms integer not null
);
create index if not exists gateway_events_state on gateway_events(state, updated_at_ms);

create table if not exists gateway_logs(
  id integer primary key autoincrement,
  at_ms integer not null,
  level text not null,
  target text,
  message text not null,
  data_json text
);
create index if not exists gateway_logs_target_id on gateway_logs(target, id);

create table if not exists gateway_services(
  name text primary key,
  spec_json text not null,
  status_json text not null,
  updated_at_ms integer not null
);

create table if not exists gateway_agent_runtimes(
  id text primary key,
  descriptor_json text not null,
  updated_at_ms integer not null
);

create table if not exists gateway_workers(
  id text primary key,
  queue text not null,
  state text not null,
  worker_json text not null,
  heartbeat_at_ms integer not null
);
create index if not exists gateway_workers_queue_state on gateway_workers(queue, state, heartbeat_at_ms);
"#;
