create table public.support_requests (
  id text primary key,
  created_by text not null,
  email text not null check (length(email) between 3 and 320),
  subject text not null check (length(subject) between 1 and 120),
  message text not null check (length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index support_requests_created_at_idx on public.support_requests(created_at desc);
create index support_requests_created_by_idx on public.support_requests(created_by, created_at desc);

alter table public.support_requests enable row level security;
revoke all on table public.support_requests from anon, authenticated;
grant all on table public.support_requests to service_role;
