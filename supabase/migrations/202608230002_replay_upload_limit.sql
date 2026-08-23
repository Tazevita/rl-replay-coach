create or replace function public.publish_replay(
  p_id text,
  p_content_hash text,
  p_created_by text,
  p_filename text,
  p_analyzed_at timestamptz,
  p_replay_object_key text,
  p_bundle jsonb,
  p_players jsonb,
  p_mistakes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_bundle jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_created_by, 0));

  select bundle into existing_bundle
  from public.replays
  where created_by = p_created_by and content_hash = p_content_hash;
  if found then
    return existing_bundle;
  end if;

  if (select count(*) from public.replays where created_by = p_created_by) >= 50 then
    raise exception 'You can store up to 50 replays. Delete a replay before uploading another.';
  end if;

  begin
    insert into public.replays (
      id, content_hash, filename, created_by, analyzed_at, replay_object_key, bundle
    ) values (
      p_id, p_content_hash, p_filename, p_created_by, p_analyzed_at, p_replay_object_key, p_bundle
    );
  exception when unique_violation then
    select bundle into existing_bundle
    from public.replays
    where created_by = p_created_by and content_hash = p_content_hash;
    if found then
      return existing_bundle;
    end if;
    raise;
  end;

  insert into public.players (id, display_name, updated_at)
  select distinct on (item.id) item.id, item.display_name, p_analyzed_at
  from jsonb_to_recordset(p_players) as item(id text, display_name text, team text)
  order by item.id
  on conflict (id) do update
  set display_name = excluded.display_name, updated_at = excluded.updated_at;

  insert into public.replay_players (replay_id, player_id, display_name, team)
  select p_id, item.id, item.display_name, item.team
  from jsonb_to_recordset(p_players) as item(id text, display_name text, team text);

  insert into public.mistakes (
    id, replay_id, finding_id, player_id, display_name, event_id, occurred_at_seconds,
    anchor_seconds, expected_family, actual_family, expected_intent, actual_intent,
    score, sample_count, "window", start_time_seconds, end_time_seconds,
    expected_confidence, actual_confidence, text, context
  )
  select
    item.id, p_id, item.finding_id, item.player_id, item.display_name, item.event_id,
    item.occurred_at_seconds, item.anchor_seconds, item.expected_family, item.actual_family,
    item.expected_intent, item.actual_intent, item.score, item.sample_count, item."window",
    item.start_time_seconds, item.end_time_seconds, item.expected_confidence,
    item.actual_confidence, item.text, item.context
  from jsonb_to_recordset(p_mistakes) as item(
    id text, finding_id text, player_id text, display_name text, event_id text,
    occurred_at_seconds double precision, anchor_seconds double precision,
    expected_family text, actual_family text, expected_intent text, actual_intent text,
    score double precision, sample_count integer, "window" text,
    start_time_seconds double precision, end_time_seconds double precision,
    expected_confidence double precision, actual_confidence double precision,
    text text, context jsonb
  );

  return p_bundle;
end;
$$;
