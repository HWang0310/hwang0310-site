create type public.app_role as enum ('user', 'admin', 'root_admin');
create type public.report_visibility as enum ('public', 'private');
create type public.report_status as enum ('staging', 'online', 'offline');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  employee_no text not null unique check (btrim(employee_no) <> ''),
  phone text not null unique check (phone ~ '^1[0-9]{10}$'),
  email text not null unique check (btrim(email) <> ''),
  role public.app_role not null default 'user',
  is_active boolean not null default true,
  uses_initial_password boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  report_date date primary key,
  title text not null check (btrim(title) <> ''),
  release_id uuid unique,
  storage_prefix text,
  visibility public.report_visibility not null default 'private',
  pinned boolean not null default false,
  status public.report_status not null default 'staging',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  file_count integer not null default 0 check (file_count >= 0),
  published_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_private_storage_check check (
    visibility = 'public'
    or (release_id is not null and nullif(btrim(storage_prefix), '') is not null)
  ),
  constraint reports_online_published_check check (
    status <> 'online' or published_at is not null
  )
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (btrim(event_type) <> ''),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_type text check (target_type is null or btrim(target_type) <> ''),
  target_id text check (target_id is null or btrim(target_id) <> ''),
  success boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  limit_key text not null check (btrim(limit_key) <> ''),
  action text not null check (btrim(action) <> ''),
  window_started_at timestamptz not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  pending_count integer not null default 0 check (pending_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (limit_key, action)
);

create table public.rate_limit_reservations (
  reservation_id uuid not null,
  limit_key text not null,
  action text not null,
  window_started_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (reservation_id, limit_key, action),
  foreign key (limit_key, action)
    references public.rate_limits(limit_key, action)
    on delete cascade
);

create index reports_online_report_date_idx
  on public.reports (report_date)
  where status = 'online';

create index audit_events_actor_user_id_created_at_idx
  on public.audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;

create index audit_events_created_at_idx
  on public.audit_events (created_at desc);

create index rate_limits_blocked_until_idx
  on public.rate_limits (blocked_until)
  where blocked_until is not null;

create index rate_limit_reservations_limit_idx
  on public.rate_limit_reservations (limit_key, action, window_started_at);

create function public.set_income_forecast_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_income_forecast_updated_at();

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_income_forecast_updated_at();

create function public.protect_public_income_reports()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.report_date in (date '2026-07-20', date '2026-07-25') then
      raise exception using
        errcode = '23514',
        message = 'protected public income reports cannot be deleted';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE'
    and old.report_date in (date '2026-07-20', date '2026-07-25')
    and new.report_date <> old.report_date
  then
    raise exception using
      errcode = '23514',
      message = 'protected public income report dates cannot be changed';
  end if;

  if new.report_date in (date '2026-07-20', date '2026-07-25') then
    new.visibility := 'public'::public.report_visibility;
    new.pinned := true;
    new.status := 'online'::public.report_status;
    new.published_at := coalesce(new.published_at, now());
    new.cleaned_at := null;
  end if;

  return new;
end;
$$;

create trigger reports_protect_public_dates
before insert or update or delete on public.reports
for each row execute function public.protect_public_income_reports();

create function public.check_rate_limit(
  p_limit_key text,
  p_action text,
  p_window_seconds integer,
  p_max_failures integer,
  p_block_seconds integer,
  p_now timestamptz default now()
)
returns table (
  is_blocked boolean,
  blocked_until timestamptz,
  failure_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_limit_key), '') is null
    or nullif(btrim(p_action), '') is null
    or p_window_seconds is null
    or p_window_seconds <= 0
    or p_max_failures is null
    or p_max_failures <= 0
    or p_block_seconds is null
    or p_block_seconds <= 0
    or p_now is null
  then
    raise exception using
      errcode = '22023',
      message = 'rate limit parameters must be non-empty and positive';
  end if;

  return query
  with checked_limit as (
    update public.rate_limits as current_limit
    set
      window_started_at = case
        when current_limit.blocked_until > p_now
          then current_limit.window_started_at
        when current_limit.blocked_until is not null
          or current_limit.window_started_at
            + make_interval(secs => p_window_seconds) <= p_now
          then p_now
        else current_limit.window_started_at
      end,
      failure_count = case
        when current_limit.blocked_until > p_now
          then current_limit.failure_count
        when current_limit.blocked_until is not null
          or current_limit.window_started_at
            + make_interval(secs => p_window_seconds) <= p_now
          then 0
        else current_limit.failure_count
      end,
      blocked_until = case
        when current_limit.blocked_until > p_now
          then current_limit.blocked_until
        when current_limit.blocked_until is not null
          or current_limit.window_started_at
            + make_interval(secs => p_window_seconds) <= p_now
          then null
        when current_limit.failure_count >= p_max_failures
          then p_now + make_interval(secs => p_block_seconds)
        else null
      end,
      updated_at = p_now
    where current_limit.limit_key = p_limit_key
      and current_limit.action = p_action
    returning
      current_limit.failure_count,
      current_limit.blocked_until
  )
  select
    coalesce(checked_limit.blocked_until > p_now, false),
    checked_limit.blocked_until,
    coalesce(checked_limit.failure_count, 0)
  from (values (1)) as singleton(value)
  left join checked_limit on true;
end;
$$;

create function public.record_rate_limit_failure(
  p_limit_key text,
  p_action text,
  p_window_seconds integer,
  p_max_failures integer,
  p_block_seconds integer,
  p_now timestamptz default now()
)
returns table (
  failure_count integer,
  blocked_until timestamptz,
  is_blocked boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_limit_key), '') is null
    or nullif(btrim(p_action), '') is null
    or p_window_seconds is null
    or p_window_seconds <= 0
    or p_max_failures is null
    or p_max_failures <= 0
    or p_block_seconds is null
    or p_block_seconds <= 0
    or p_now is null
  then
    raise exception using
      errcode = '22023',
      message = 'rate limit parameters must be non-empty and positive';
  end if;

  return query
  insert into public.rate_limits as current_limit (
    limit_key,
    action,
    window_started_at,
    failure_count,
    blocked_until,
    updated_at
  )
  values (
    p_limit_key,
    p_action,
    p_now,
    1,
    null,
    p_now
  )
  on conflict (limit_key, action) do update
  set
    window_started_at = case
      when current_limit.blocked_until is not null
        and current_limit.blocked_until <= p_now
        then p_now
      when current_limit.window_started_at
          + make_interval(secs => p_window_seconds) <= p_now
        then p_now
      else current_limit.window_started_at
    end,
    failure_count = case
      when current_limit.blocked_until is not null
        and current_limit.blocked_until <= p_now
        then 1
      when current_limit.window_started_at
          + make_interval(secs => p_window_seconds) <= p_now
        then 1
      else current_limit.failure_count + 1
    end,
    blocked_until = case
      when current_limit.blocked_until > p_now
        then current_limit.blocked_until
      else null
    end,
    updated_at = p_now
  returning
    current_limit.failure_count,
    current_limit.blocked_until,
    coalesce(current_limit.blocked_until > p_now, false);
end;
$$;

create function public.clear_rate_limit(
  p_limit_key text,
  p_action text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  delete from public.rate_limits
  where limit_key = p_limit_key
    and action = p_action;
$$;

create function public.reserve_rate_limit_attempt(
  p_reservation_id uuid,
  p_limit_key text,
  p_action text,
  p_window_seconds integer,
  p_max_failures integer,
  p_block_seconds integer,
  p_now timestamptz default now()
)
returns table (
  is_reserved boolean,
  is_blocked boolean,
  blocked_until timestamptz,
  failure_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window_started_at timestamptz;
  v_failure_count integer;
  v_pending_count integer;
  v_blocked_until timestamptz;
  v_inserted_count integer;
begin
  if p_reservation_id is null
    or nullif(btrim(p_limit_key), '') is null
    or nullif(btrim(p_action), '') is null
    or p_window_seconds is null
    or p_window_seconds <= 0
    or p_max_failures is null
    or p_max_failures <= 0
    or p_block_seconds is null
    or p_block_seconds <= 0
    or p_now is null
  then
    raise exception using
      errcode = '22023',
      message = 'rate limit reservation parameters must be non-empty and positive';
  end if;

  insert into public.rate_limits (
    limit_key,
    action,
    window_started_at,
    failure_count,
    pending_count,
    blocked_until,
    updated_at
  )
  values (p_limit_key, p_action, p_now, 0, 0, null, p_now)
  on conflict (limit_key, action) do nothing;

  select
    current_limit.window_started_at,
    current_limit.failure_count,
    current_limit.pending_count,
    current_limit.blocked_until
  into
    v_window_started_at,
    v_failure_count,
    v_pending_count,
    v_blocked_until
  from public.rate_limits as current_limit
  where current_limit.limit_key = p_limit_key
    and current_limit.action = p_action
  for update;

  if v_blocked_until > p_now then
    return query select false, true, v_blocked_until, v_failure_count;
    return;
  end if;

  if v_blocked_until is not null
    or v_window_started_at + make_interval(secs => p_window_seconds) <= p_now
  then
    delete from public.rate_limit_reservations as reservation
    where reservation.limit_key = p_limit_key
      and reservation.action = p_action;

    update public.rate_limits as current_limit
    set
      window_started_at = p_now,
      failure_count = 0,
      pending_count = 0,
      blocked_until = null,
      updated_at = p_now
    where current_limit.limit_key = p_limit_key
      and current_limit.action = p_action;

    v_window_started_at := p_now;
    v_failure_count := 0;
    v_pending_count := 0;
    v_blocked_until := null;
  end if;

  if exists (
    select 1
    from public.rate_limit_reservations as reservation
    where reservation.reservation_id = p_reservation_id
      and reservation.limit_key = p_limit_key
      and reservation.action = p_action
      and reservation.window_started_at = v_window_started_at
  ) then
    return query select true, false, null::timestamptz, v_failure_count;
    return;
  end if;

  if v_failure_count + v_pending_count >= p_max_failures then
    v_blocked_until := p_now + make_interval(secs => p_block_seconds);
    update public.rate_limits as current_limit
    set blocked_until = v_blocked_until, updated_at = p_now
    where current_limit.limit_key = p_limit_key
      and current_limit.action = p_action;
    return query select false, true, v_blocked_until, v_failure_count;
    return;
  end if;

  insert into public.rate_limit_reservations (
    reservation_id,
    limit_key,
    action,
    window_started_at,
    created_at
  )
  values (
    p_reservation_id,
    p_limit_key,
    p_action,
    v_window_started_at,
    p_now
  )
  on conflict (reservation_id, limit_key, action) do nothing;
  get diagnostics v_inserted_count = row_count;

  if v_inserted_count <> 1 then
    raise exception using
      errcode = '40001',
      message = 'rate limit reservation could not be created';
  end if;

  update public.rate_limits as current_limit
  set
    pending_count = current_limit.pending_count + 1,
    updated_at = p_now
  where current_limit.limit_key = p_limit_key
    and current_limit.action = p_action;

  return query select true, false, null::timestamptz, v_failure_count;
end;
$$;

create function public.finalize_rate_limit_attempt(
  p_reservation_id uuid,
  p_limit_key text,
  p_action text,
  p_outcome text,
  p_max_failures integer,
  p_now timestamptz default now()
)
returns table (
  applied boolean,
  failure_count integer,
  pending_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_current_window timestamptz;
  v_reservation_window timestamptz;
  v_failure_count integer;
  v_pending_count integer;
begin
  if p_reservation_id is null
    or nullif(btrim(p_limit_key), '') is null
    or nullif(btrim(p_action), '') is null
    or p_outcome is null
    or p_outcome not in ('failure', 'release', 'success_clear')
    or p_max_failures is null
    or p_max_failures <= 0
    or p_now is null
  then
    raise exception using
      errcode = '22023',
      message = 'invalid rate limit finalization parameters';
  end if;

  select current_limit.window_started_at
  into v_current_window
  from public.rate_limits as current_limit
  where current_limit.limit_key = p_limit_key
    and current_limit.action = p_action
  for update;

  if not found then
    return query select false, 0, 0;
    return;
  end if;

  delete from public.rate_limit_reservations as reservation
  where reservation.reservation_id = p_reservation_id
    and reservation.limit_key = p_limit_key
    and reservation.action = p_action
  returning reservation.window_started_at into v_reservation_window;

  if not found then
    select current_limit.failure_count, current_limit.pending_count
    into v_failure_count, v_pending_count
    from public.rate_limits as current_limit
    where current_limit.limit_key = p_limit_key
      and current_limit.action = p_action;
    return query select false, v_failure_count, v_pending_count;
    return;
  end if;

  update public.rate_limits as current_limit
  set
    pending_count = case
      when v_reservation_window = v_current_window
        then greatest(current_limit.pending_count - 1, 0)
      else current_limit.pending_count
    end,
    failure_count = case
      when p_outcome = 'success_clear' then 0
      when p_outcome = 'failure' and v_reservation_window = v_current_window
        then current_limit.failure_count + 1
      else current_limit.failure_count
    end,
    blocked_until = case
      when p_outcome = 'success_clear' then null
      when p_outcome = 'release'
        and v_reservation_window = v_current_window
        and current_limit.failure_count
          + greatest(current_limit.pending_count - 1, 0) < p_max_failures
        then null
      else current_limit.blocked_until
    end,
    updated_at = p_now
  where current_limit.limit_key = p_limit_key
    and current_limit.action = p_action
  returning current_limit.failure_count, current_limit.pending_count
  into v_failure_count, v_pending_count;

  return query select true, v_failure_count, v_pending_count;
end;
$$;

create function public.finalize_report_publish(
  p_report_date date,
  p_title text,
  p_release_id uuid,
  p_storage_prefix text,
  p_size_bytes bigint,
  p_file_count integer,
  p_cleaned_report_dates date[] default '{}'::date[],
  p_actor_user_id uuid default null,
  p_published_at timestamptz default now(),
  p_audit_metadata jsonb default '{}'::jsonb
)
returns public.reports
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_cleaned_report_dates date[];
  v_cleaned_report_count integer;
  v_lock_date date;
  v_report public.reports;
begin
  if p_report_date is null
    or nullif(btrim(p_title), '') is null
    or p_release_id is null
    or nullif(btrim(p_storage_prefix), '') is null
    or p_size_bytes < 0
    or p_file_count < 0
    or p_published_at is null
    or p_audit_metadata is null
    or jsonb_typeof(p_audit_metadata) <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid report publication parameters';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_cleaned_report_dates, '{}'::date[])) as requested(report_date)
    where requested.report_date is null
       or requested.report_date = p_report_date
  ) then
    raise exception using
      errcode = '22023',
      message = 'cleanup dates must be non-null and exclude the published report';
  end if;

  select coalesce(array_agg(distinct requested.report_date order by requested.report_date), '{}'::date[])
  into v_cleaned_report_dates
  from unnest(coalesce(p_cleaned_report_dates, '{}'::date[])) as requested(report_date);

  for v_lock_date in
    select requested.report_date
    from unnest(array_append(v_cleaned_report_dates, p_report_date)) as requested(report_date)
    order by requested.report_date
  loop
    perform pg_advisory_xact_lock(
      1229867334,
      (v_lock_date - date '2000-01-01')::integer
    );
  end loop;

  with cleaned_reports as (
    update public.reports
    set
      status = 'offline',
      cleaned_at = p_published_at
    where report_date = any(v_cleaned_report_dates)
      and visibility = 'private'
      and status = 'online'
      and not pinned
    returning report_date
  )
  select count(*)::integer
  into v_cleaned_report_count
  from cleaned_reports;

  if v_cleaned_report_count <> cardinality(v_cleaned_report_dates) then
    raise exception using
      errcode = '23514',
      message = 'all cleanup reports must be online, private, and unpinned';
  end if;

  insert into public.reports (
    report_date,
    title,
    release_id,
    storage_prefix,
    visibility,
    pinned,
    status,
    size_bytes,
    file_count,
    published_at,
    cleaned_at
  )
  values (
    p_report_date,
    btrim(p_title),
    p_release_id,
    btrim(p_storage_prefix),
    'private',
    false,
    'online',
    p_size_bytes,
    p_file_count,
    p_published_at,
    null
  )
  on conflict (report_date) do update
  set
    title = excluded.title,
    release_id = excluded.release_id,
    storage_prefix = excluded.storage_prefix,
    visibility = excluded.visibility,
    pinned = public.reports.pinned,
    status = excluded.status,
    size_bytes = excluded.size_bytes,
    file_count = excluded.file_count,
    published_at = excluded.published_at,
    cleaned_at = null
  returning * into v_report;

  insert into public.audit_events (
    event_type,
    actor_user_id,
    target_type,
    target_id,
    success,
    metadata,
    created_at
  )
  values (
    'report_publish_finalized',
    p_actor_user_id,
    'report',
    p_report_date::text,
    true,
    p_audit_metadata || jsonb_build_object(
      'release_id', p_release_id,
      'cleaned_report_dates', to_jsonb(v_cleaned_report_dates),
      'size_bytes', p_size_bytes,
      'file_count', p_file_count
    ),
    p_published_at
  );

  return v_report;
end;
$$;

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limits enable row level security;
alter table public.rate_limit_reservations enable row level security;

revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.reports from public, anon, authenticated, service_role;
revoke all on table public.audit_events from public, anon, authenticated, service_role;
revoke all on table public.rate_limits from public, anon, authenticated, service_role;
revoke all on table public.rate_limit_reservations from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.reports to service_role;
grant select, insert on table public.audit_events to service_role;
grant select, insert, update, delete on table public.rate_limits to service_role;
grant select, insert, delete on table public.rate_limit_reservations to service_role;

revoke all on sequence public.audit_events_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

revoke all on type public.app_role from public, anon, authenticated, service_role;
revoke all on type public.report_visibility from public, anon, authenticated, service_role;
revoke all on type public.report_status from public, anon, authenticated, service_role;

grant usage on type public.app_role to service_role;
grant usage on type public.report_visibility to service_role;
grant usage on type public.report_status to service_role;

revoke all on function public.set_income_forecast_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.protect_public_income_reports() from public, anon, authenticated, service_role;
revoke all on function public.check_rate_limit(text, text, integer, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.record_rate_limit_failure(text, text, integer, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.clear_rate_limit(text, text) from public, anon, authenticated, service_role;
revoke all on function public.reserve_rate_limit_attempt(uuid, text, text, integer, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.finalize_rate_limit_attempt(uuid, text, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.finalize_report_publish(date, text, uuid, text, bigint, integer, date[], uuid, timestamptz, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.check_rate_limit(text, text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.record_rate_limit_failure(text, text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.clear_rate_limit(text, text) to service_role;
grant execute on function public.reserve_rate_limit_attempt(uuid, text, text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.finalize_rate_limit_attempt(uuid, text, text, text, integer, timestamptz) to service_role;
grant execute on function public.finalize_report_publish(date, text, uuid, text, bigint, integer, date[], uuid, timestamptz, jsonb) to service_role;
