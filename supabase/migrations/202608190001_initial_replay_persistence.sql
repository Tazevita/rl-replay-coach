create table public.replays (
  id text primary key check (length(id) > 0),
  content_hash text not null check (length(content_hash) > 0),
  filename text not null check (length(filename) > 0),
  created_by text not null check (length(created_by) > 0),
  analyzed_at timestamptz not null,
  replay_object_key text not null unique check (length(replay_object_key) > 0),
  bundle jsonb not null check (jsonb_typeof(bundle) = 'object'),
  unique (created_by, content_hash)
);

create table public.players (
  id text primary key check (length(id) > 0),
  display_name text not null check (length(display_name) > 0),
  updated_at timestamptz not null
);

create table public.replay_players (
  replay_id text not null references public.replays(id) on delete cascade,
  player_id text not null references public.players(id),
  display_name text not null check (length(display_name) > 0),
  team text not null check (team in ('blue', 'orange')),
  primary key (replay_id, player_id)
);

create table public.mistakes (
  id text primary key check (length(id) > 0),
  replay_id text not null references public.replays(id) on delete cascade,
  finding_id text not null check (length(finding_id) > 0),
  player_id text not null references public.players(id),
  display_name text not null check (length(display_name) > 0),
  event_id text not null check (length(event_id) > 0),
  occurred_at_seconds double precision not null check (occurred_at_seconds >= 0),
  anchor_seconds double precision not null check (anchor_seconds >= 0),
  expected_family text not null check (length(expected_family) > 0),
  actual_family text not null check (length(actual_family) > 0),
  expected_intent text not null check (length(expected_intent) > 0),
  actual_intent text not null check (length(actual_intent) > 0),
  score double precision not null check (score >= 0),
  sample_count integer not null check (sample_count > 0),
  "window" text not null check (length("window") > 0),
  start_time_seconds double precision not null check (start_time_seconds >= 0),
  end_time_seconds double precision not null check (end_time_seconds >= start_time_seconds),
  expected_confidence double precision not null check (expected_confidence between 0 and 1),
  actual_confidence double precision not null check (actual_confidence between 0 and 1),
  text text not null check (length(text) > 0),
  context jsonb check (context is null or jsonb_typeof(context) = 'object'),
  explanation_text text,
  explanation_generated_at timestamptz,
  explanation_model text,
  explanation_prompt_version text,
  unique (replay_id, finding_id),
  foreign key (replay_id, player_id) references public.replay_players(replay_id, player_id),
  check (id = replay_id || ':' || finding_id),
  check (
    (explanation_text is null and explanation_generated_at is null and explanation_model is null and explanation_prompt_version is null)
    or
    (length(explanation_text) > 0 and explanation_generated_at is not null and length(explanation_model) > 0 and length(explanation_prompt_version) > 0)
  )
);

create table public.replay_jobs (
  id text primary key check (length(id) > 0),
  created_by text not null check (length(created_by) > 0),
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (
    (status in ('queued', 'processing') and result is null and error is null)
    or (status = 'completed' and result is not null and error is null)
    or (status = 'failed' and result is null and length(error) > 0)
  )
);

create index replays_creator_idx on public.replays(created_by);
create index replay_players_name_idx on public.replay_players(lower(display_name));
create index replay_players_player_idx on public.replay_players(player_id);
create index mistakes_player_idx on public.mistakes(player_id);
create index mistakes_replay_time_idx on public.mistakes(replay_id, occurred_at_seconds desc);
create index replay_jobs_creator_idx on public.replay_jobs(created_by, created_at desc);

alter table public.replays enable row level security;
alter table public.players enable row level security;
alter table public.replay_players enable row level security;
alter table public.mistakes enable row level security;
alter table public.replay_jobs enable row level security;

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
  select bundle into existing_bundle
  from public.replays
  where created_by = p_created_by and content_hash = p_content_hash;
  if found then
    return existing_bundle;
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

revoke all on table public.replays, public.players, public.replay_players, public.mistakes, public.replay_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.replays, public.players, public.replay_players, public.mistakes, public.replay_jobs to service_role;
revoke all on function public.publish_replay(text, text, text, text, timestamptz, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_replay(text, text, text, text, timestamptz, text, jsonb, jsonb, jsonb) to service_role;
