alter table public.replay_jobs
  add column filename text check (filename is null or length(filename) > 0),
  add column content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  add column upload_bytes bigint check (upload_bytes is null or upload_bytes between 1 and 104857600),
  add column source_object_key text check (source_object_key is null or source_object_key like '%.replay'),
  add column parsed_object_key text check (parsed_object_key is null or parsed_object_key like '%.json'),
  add column analysis_object_key text check (analysis_object_key is null or analysis_object_key like '%.json'),
  add column dispatch_lease_at timestamptz,
  add column dispatched_at timestamptz,
  add column finalization_lease_at timestamptz;

create index replay_jobs_reconcile_idx on public.replay_jobs(status, updated_at);

create or replace function public.claim_replay_job_dispatch(
  p_id text,
  p_created_by text,
  p_now timestamptz,
  p_stale_before timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.replay_jobs
  set dispatch_lease_at = p_now, updated_at = p_now
  where id = p_id
    and created_by = p_created_by
    and status = 'queued'
    and dispatched_at is null
    and (dispatch_lease_at is null or dispatch_lease_at < p_stale_before);
  return found;
end;
$$;

create or replace function public.claim_replay_job_finalization(
  p_id text,
  p_created_by text,
  p_now timestamptz,
  p_stale_before timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.replay_jobs
  set finalization_lease_at = p_now, updated_at = p_now
  where id = p_id
    and created_by = p_created_by
    and status = 'processing'
    and (finalization_lease_at is null or finalization_lease_at < p_stale_before);
  return found;
end;
$$;

revoke all on function public.claim_replay_job_dispatch(text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_replay_job_finalization(text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_replay_job_dispatch(text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_replay_job_finalization(text, text, timestamptz, timestamptz) to service_role;
