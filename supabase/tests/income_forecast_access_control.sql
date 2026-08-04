begin;

create extension if not exists pgtap with schema extensions;

select plan(86);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'reports', 'reports table exists');
select has_table('public', 'audit_events', 'audit_events table exists');
select has_table('public', 'rate_limits', 'rate_limits table exists');
select has_table('public', 'rate_limit_reservations', 'rate_limit_reservations table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reports'::regclass),
  'reports has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass),
  'audit_events has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass),
  'rate_limits has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rate_limit_reservations'::regclass),
  'rate_limit_reservations has RLS enabled'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
    where has_table_privilege(role_name, 'public.profiles', privilege_name)
  )
  and (
    select bool_and(has_table_privilege('service_role', 'public.profiles', privilege_name))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
  ),
  'profiles is available only to service_role'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
    where has_table_privilege(role_name, 'public.reports', privilege_name)
  )
  and (
    select bool_and(has_table_privilege('service_role', 'public.reports', privilege_name))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
  ),
  'reports is available only to service_role'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
    where has_table_privilege(role_name, 'public.audit_events', privilege_name)
  )
  and has_table_privilege('service_role', 'public.audit_events', 'SELECT')
  and has_table_privilege('service_role', 'public.audit_events', 'INSERT')
  and not has_table_privilege('service_role', 'public.audit_events', 'UPDATE')
  and not has_table_privilege('service_role', 'public.audit_events', 'DELETE'),
  'audit_events grants service_role append-only access'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
    where has_table_privilege(role_name, 'public.rate_limits', privilege_name)
  )
  and (
    select bool_and(has_table_privilege('service_role', 'public.rate_limits', privilege_name))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
  ),
  'rate_limits is available only to service_role'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
    where has_table_privilege(role_name, 'public.rate_limit_reservations', privilege_name)
  )
  and (
    select bool_and(has_table_privilege('service_role', 'public.rate_limit_reservations', privilege_name))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name
  ),
  'rate_limit_reservations is available only to service_role'
);

select ok(
  to_regprocedure('public.check_rate_limit(text,text,integer,integer,integer,timestamp with time zone)') is not null,
  'check_rate_limit RPC exists'
);
select ok(
  to_regprocedure('public.record_rate_limit_failure(text,text,integer,integer,integer,timestamp with time zone)') is not null,
  'record_rate_limit_failure RPC exists'
);
select ok(
  to_regprocedure('public.clear_rate_limit(text,text)') is not null,
  'clear_rate_limit RPC exists'
);
select ok(
  to_regprocedure('public.reserve_rate_limit_attempt(uuid,text,text,integer,integer,integer,timestamp with time zone)') is not null,
  'reserve_rate_limit_attempt RPC exists'
);
select ok(
  to_regprocedure('public.finalize_rate_limit_attempt(uuid,text,text,text,timestamp with time zone)') is not null,
  'finalize_rate_limit_attempt RPC exists'
);
select ok(
  to_regprocedure('public.finalize_report_publish(date,text,uuid,text,bigint,integer,date[],uuid,timestamp with time zone,jsonb)') is not null,
  'finalize_report_publish RPC exists'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.check_rate_limit(text,text,integer,integer,integer,timestamp with time zone)'::regprocedure),
  false,
  'check_rate_limit uses security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.record_rate_limit_failure(text,text,integer,integer,integer,timestamp with time zone)'::regprocedure),
  false,
  'record_rate_limit_failure uses security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.clear_rate_limit(text,text)'::regprocedure),
  false,
  'clear_rate_limit uses security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.reserve_rate_limit_attempt(uuid,text,text,integer,integer,integer,timestamp with time zone)'::regprocedure),
  false,
  'reserve_rate_limit_attempt uses security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.finalize_rate_limit_attempt(uuid,text,text,text,timestamp with time zone)'::regprocedure),
  false,
  'finalize_rate_limit_attempt uses security invoker'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.finalize_report_publish(date,text,uuid,text,bigint,integer,date[],uuid,timestamp with time zone,jsonb)'::regprocedure),
  false,
  'finalize_report_publish uses security invoker'
);

select ok(
  not has_function_privilege('anon', 'public.check_rate_limit(text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.check_rate_limit(text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.check_rate_limit(text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE'),
  'only service_role can execute check_rate_limit'
);
select ok(
  not has_function_privilege('anon', 'public.record_rate_limit_failure(text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_rate_limit_failure(text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_rate_limit_failure(text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE'),
  'only service_role can execute record_rate_limit_failure'
);
select ok(
  not has_function_privilege('anon', 'public.clear_rate_limit(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.clear_rate_limit(text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.clear_rate_limit(text,text)', 'EXECUTE'),
  'only service_role can execute clear_rate_limit'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_rate_limit_attempt(uuid,text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reserve_rate_limit_attempt(uuid,text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reserve_rate_limit_attempt(uuid,text,text,integer,integer,integer,timestamp with time zone)', 'EXECUTE'),
  'only service_role can execute reserve_rate_limit_attempt'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_rate_limit_attempt(uuid,text,text,text,timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_rate_limit_attempt(uuid,text,text,text,timestamp with time zone)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_rate_limit_attempt(uuid,text,text,text,timestamp with time zone)', 'EXECUTE'),
  'only service_role can execute finalize_rate_limit_attempt'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_report_publish(date,text,uuid,text,bigint,integer,date[],uuid,timestamp with time zone,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_report_publish(date,text,uuid,text,bigint,integer,date[],uuid,timestamp with time zone,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_report_publish(date,text,uuid,text,bigint,integer,date[],uuid,timestamp with time zone,jsonb)', 'EXECUTE'),
  'only service_role can execute finalize_report_publish'
);

set local role service_role;

select is(
  current_user,
  'service_role',
  'behavior tests execute with the real service_role privileges and RLS bypass'
);

insert into public.reports (
  report_date,
  title,
  visibility,
  pinned,
  status
)
values (
  date '2026-07-20',
  'Public sample',
  'private',
  false,
  'staging'
);

select is(
  (select visibility::text from public.reports where report_date = date '2026-07-20'),
  'public',
  'public sample visibility is forced to public on insert'
);
select ok(
  (select pinned from public.reports where report_date = date '2026-07-20'),
  'public sample is forced to pinned on insert'
);
select is(
  (select status::text from public.reports where report_date = date '2026-07-20'),
  'online',
  'public sample status is forced to online on insert'
);

update public.reports
set visibility = 'private', pinned = false, status = 'offline'
where report_date = date '2026-07-20';

select is(
  (select visibility::text from public.reports where report_date = date '2026-07-20'),
  'public',
  'public sample visibility remains public on update'
);
select ok(
  (select pinned from public.reports where report_date = date '2026-07-20'),
  'public sample remains pinned on update'
);
select is(
  (select status::text from public.reports where report_date = date '2026-07-20'),
  'online',
  'public sample remains online on update'
);
select throws_ok(
  $test$delete from public.reports where report_date = date '2026-07-20'$test$,
  '23514',
  'protected public income reports cannot be deleted',
  'public samples cannot be deleted'
);
select throws_ok(
  $test$update public.reports set report_date = date '2026-07-21' where report_date = date '2026-07-20'$test$,
  '23514',
  'protected public income report dates cannot be changed',
  'public sample dates cannot be changed'
);

do $test$
begin
  for attempt in 1..9 loop
    perform * from public.record_rate_limit_failure(
      'phone-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 00:00:00+00'
    );
  end loop;
end;
$test$;

select is(
  (select is_blocked from public.check_rate_limit(
    'phone-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 00:00:00+00'
  )),
  false,
  'phone is not blocked before the 10th failure'
);
select results_eq(
  $test$
    select failure_count, blocked_until, is_blocked
    from public.record_rate_limit_failure(
      'phone-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 00:00:00+00'
    )
  $test$,
  $test$values (10, null::timestamptz, false)$test$,
  'the 10th phone failure is recorded without starting the pause'
);
select is(
  (select blocked_until from public.rate_limits where limit_key = 'phone-key' and action = 'login_phone'),
  null::timestamptz,
  'the 10th phone failure does not start the pause'
);
select is(
  (select blocked_until from public.check_rate_limit(
    'phone-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 00:04:00+00'
  )),
  timestamptz '2026-08-04 00:09:00+00',
  'the 11th phone attempt starts a complete five-minute pause'
);
select ok(
  (select is_blocked from public.check_rate_limit(
    'phone-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 00:04:00+00'
  )),
  'the 11th phone attempt is blocked before authentication'
);

do $test$
begin
  for attempt in 1..19 loop
    perform * from public.record_rate_limit_failure(
      'ip-key', 'login_ip', 300, 20, 300, timestamptz '2026-08-04 01:00:00+00'
    );
  end loop;
end;
$test$;

select is(
  (select is_blocked from public.check_rate_limit(
    'ip-key', 'login_ip', 300, 20, 300, timestamptz '2026-08-04 01:00:00+00'
  )),
  false,
  'IP is not blocked before the 20th failure'
);
select results_eq(
  $test$
    select failure_count, blocked_until, is_blocked
    from public.record_rate_limit_failure(
      'ip-key', 'login_ip', 300, 20, 300, timestamptz '2026-08-04 01:00:00+00'
    )
  $test$,
  $test$values (20, null::timestamptz, false)$test$,
  'the 20th IP failure is recorded without starting the pause'
);
select is(
  (select blocked_until from public.rate_limits where limit_key = 'ip-key' and action = 'login_ip'),
  null::timestamptz,
  'the 20th IP failure does not start the pause'
);
select is(
  (select blocked_until from public.check_rate_limit(
    'ip-key', 'login_ip', 300, 20, 300, timestamptz '2026-08-04 01:03:00+00'
  )),
  timestamptz '2026-08-04 01:08:00+00',
  'the 21st IP attempt starts a complete five-minute pause'
);
select ok(
  (select is_blocked from public.check_rate_limit(
    'ip-key', 'login_ip', 300, 20, 300, timestamptz '2026-08-04 01:03:00+00'
  )),
  'the 21st IP attempt is blocked before authentication'
);

do $test$
begin
  for attempt in 1..2 loop
    perform * from public.record_rate_limit_failure(
      'root-key', 'login_root_admin', 300, 3, 300, timestamptz '2026-08-04 02:00:00+00'
    );
  end loop;
end;
$test$;

select is(
  (select is_blocked from public.check_rate_limit(
    'root-key', 'login_root_admin', 300, 3, 300, timestamptz '2026-08-04 02:00:00+00'
  )),
  false,
  'root admin is not blocked before the 3rd failure'
);
select results_eq(
  $test$
    select failure_count, blocked_until, is_blocked
    from public.record_rate_limit_failure(
      'root-key', 'login_root_admin', 300, 3, 300, timestamptz '2026-08-04 02:00:00+00'
    )
  $test$,
  $test$values (3, null::timestamptz, false)$test$,
  'the 3rd root-admin failure is recorded without starting the pause'
);
select is(
  (select blocked_until from public.rate_limits where limit_key = 'root-key' and action = 'login_root_admin'),
  null::timestamptz,
  'the 3rd root-admin failure does not start the pause'
);
select is(
  (select blocked_until from public.check_rate_limit(
    'root-key', 'login_root_admin', 300, 3, 300, timestamptz '2026-08-04 02:02:00+00'
  )),
  timestamptz '2026-08-04 02:07:00+00',
  'the 4th root-admin attempt starts a complete five-minute pause'
);
select ok(
  (select is_blocked from public.check_rate_limit(
    'root-key', 'login_root_admin', 300, 3, 300, timestamptz '2026-08-04 02:02:00+00'
  )),
  'the 4th root-admin attempt is blocked before authentication'
);

select lives_ok(
  $test$select public.clear_rate_limit('phone-key', 'login_phone')$test$,
  'a successful login can clear its phone limit'
);
select is(
  (select is_blocked from public.check_rate_limit(
    'phone-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 00:04:01+00'
  )),
  false,
  'a cleared phone limit is no longer blocked'
);

insert into public.rate_limits (
  limit_key,
  action,
  window_started_at,
  failure_count,
  pending_count,
  blocked_until,
  updated_at
)
values (
  'atomic-phone-key',
  'login_phone',
  timestamptz '2026-08-04 00:00:00+00',
  9,
  0,
  null,
  timestamptz '2026-08-04 00:00:00+00'
);

select ok(
  (select is_reserved from public.reserve_rate_limit_attempt(
    '00000000-0000-4000-8000-000000000001',
    'atomic-phone-key',
    'login_phone',
    300,
    10,
    300,
    timestamptz '2026-08-04 00:04:00+00'
  )),
  'the boundary slot is atomically reserved before authentication'
);
select is(
  (select pending_count from public.rate_limits
    where limit_key = 'atomic-phone-key' and action = 'login_phone'),
  1,
  'the atomic reservation is counted while authentication is pending'
);
select ok(
  (select is_blocked from public.reserve_rate_limit_attempt(
    '00000000-0000-4000-8000-000000000002',
    'atomic-phone-key',
    'login_phone',
    300,
    10,
    300,
    timestamptz '2026-08-04 00:04:00+00'
  )),
  'a second reservation at the boundary is blocked'
);
select is(
  (select blocked_until from public.rate_limits
    where limit_key = 'atomic-phone-key' and action = 'login_phone'),
  timestamptz '2026-08-04 00:09:00+00',
  'the concurrent boundary block lasts a complete five minutes'
);
select results_eq(
  $test$
    select applied, failure_count, pending_count
    from public.finalize_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000001',
      'atomic-phone-key',
      'login_phone',
      'failure',
      timestamptz '2026-08-04 00:04:01+00'
    )
  $test$,
  $test$values (true, 10, 0)$test$,
  'a failed authentication commits exactly one reserved failure'
);
select results_eq(
  $test$
    select applied, failure_count, pending_count
    from public.finalize_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000001',
      'atomic-phone-key',
      'login_phone',
      'failure',
      timestamptz '2026-08-04 00:04:02+00'
    )
  $test$,
  $test$values (false, 10, 0)$test$,
  'finalizing a reservation twice is idempotent'
);
select ok(
  (select pending_count >= 0 from public.rate_limits
    where limit_key = 'atomic-phone-key' and action = 'login_phone'),
  'idempotent finalization never produces a negative pending count'
);

select lives_ok(
  $test$
    select * from public.reserve_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000003',
      'stale-phone-key',
      'login_phone',
      300,
      10,
      300,
      timestamptz '2026-08-04 10:00:00+00'
    );
    select * from public.reserve_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000004',
      'stale-phone-key',
      'login_phone',
      300,
      10,
      300,
      timestamptz '2026-08-04 10:06:00+00'
    )
  $test$,
  'a new window replaces stale reservations and admits a new attempt'
);
select results_eq(
  $test$
    select applied, failure_count, pending_count
    from public.finalize_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000003',
      'stale-phone-key',
      'login_phone',
      'release',
      timestamptz '2026-08-04 10:06:01+00'
    )
  $test$,
  $test$values (false, 0, 1)$test$,
  'stale finalization does not decrement the current window'
);
select results_eq(
  $test$
    select applied, failure_count, pending_count
    from public.finalize_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000004',
      'stale-phone-key',
      'login_phone',
      'release',
      timestamptz '2026-08-04 10:06:02+00'
    )
  $test$,
  $test$values (true, 0, 0)$test$,
  'the current reservation releases without leaving pending state'
);

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
  published_at
)
values (
  date '2026-07-26',
  'Old private report',
  '00000000-0000-0000-0000-000000000026',
  'reports/2026/07/26/00000000-0000-0000-0000-000000000026/',
  'private',
  false,
  'online',
  100,
  2,
  timestamptz '2026-07-26 08:00:00+00'
);

select lives_ok(
  $test$
    select public.finalize_report_publish(
      date '2026-07-27',
      'New private report',
      '00000000-0000-0000-0000-000000000027',
      'reports/2026/07/27/00000000-0000-0000-0000-000000000027/',
      200,
      3,
      array[date '2026-07-26'],
      null,
      timestamptz '2026-07-27 08:00:00+00',
      '{"reason":"capacity"}'::jsonb
    )
  $test$,
  'finalize_report_publish activates and cleans in one call'
);
select is(
  (select status::text from public.reports where report_date = date '2026-07-26'),
  'offline',
  'finalize_report_publish marks a cleanup report offline'
);
select is(
  (select cleaned_at from public.reports where report_date = date '2026-07-26'),
  timestamptz '2026-07-27 08:00:00+00',
  'finalize_report_publish records the cleanup time'
);
select is(
  (select status::text from public.reports where report_date = date '2026-07-27'),
  'online',
  'finalize_report_publish activates the new report'
);
select is(
  (select release_id from public.reports where report_date = date '2026-07-27'),
  '00000000-0000-0000-0000-000000000027'::uuid,
  'finalize_report_publish activates the requested release'
);
select ok(
  exists (
    select 1
    from public.audit_events
    where event_type = 'report_publish_finalized'
      and target_id = '2026-07-27'
      and metadata ->> 'reason' = 'capacity'
  ),
  'finalize_report_publish writes its audit event'
);
select throws_ok(
  $test$
    select public.finalize_report_publish(
      date '2026-07-28',
      'Rejected private report',
      '00000000-0000-0000-0000-000000000028',
      'reports/2026/07/28/00000000-0000-0000-0000-000000000028/',
      300,
      4,
      array[date '2026-07-20']
    )
  $test$,
  '23514',
  'all cleanup reports must be online, private, and unpinned',
  'finalize_report_publish refuses to clean a protected public report'
);
select is(
  (select count(*) from public.reports where report_date = date '2026-07-28'),
  0::bigint,
  'a rejected finalization does not activate the new report'
);

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
  published_at
)
values (
  date '2026-07-28',
  'Rollback cleanup candidate',
  '00000000-0000-0000-0000-000000000128',
  'reports/2026/07/28/00000000-0000-0000-0000-000000000128/',
  'private',
  false,
  'online',
  400,
  5,
  timestamptz '2026-07-28 08:00:00+00'
);

select throws_like(
  $test$
    select public.finalize_report_publish(
      date '2026-07-29',
      'Rolled-back private report',
      '00000000-0000-0000-0000-000000000129',
      'reports/2026/07/29/00000000-0000-0000-0000-000000000129/',
      500,
      6,
      array[date '2026-07-28'],
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      timestamptz '2026-07-29 08:00:00+00'
    )
  $test$,
  '%audit_events_actor_user_id_fkey%',
  'audit FK failure occurs after cleanup and activation work'
);
select is(
  (select status::text from public.reports where report_date = date '2026-07-28'),
  'online',
  'whole finalize_report_publish call rolls back cleanup on audit failure'
);
select is(
  (select count(*) from public.reports where report_date = date '2026-07-29'),
  0::bigint,
  'whole finalize_report_publish call rolls back activation on audit failure'
);
select is(
  (select count(*) from public.audit_events where target_id = '2026-07-29'),
  0::bigint,
  'whole finalize_report_publish call leaves no audit row on audit failure'
);

reset role;

set local role anon;

select throws_like(
  $test$
    select * from public.check_rate_limit(
      'anon-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 03:00:00+00'
    )
  $test$,
  '%permission denied for function check_rate_limit%',
  'anon cannot execute the security-invoker rate-limit RPC'
);
select throws_like(
  $test$
    select * from public.reserve_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000005',
      'anon-key',
      'login_phone',
      300,
      10,
      300,
      timestamptz '2026-08-04 03:00:00+00'
    )
  $test$,
  '%permission denied for function reserve_rate_limit_attempt%',
  'anon cannot execute the atomic reservation RPC'
);

reset role;

set local role authenticated;

select throws_like(
  $test$
    select * from public.check_rate_limit(
      'authenticated-key', 'login_phone', 300, 10, 300, timestamptz '2026-08-04 03:00:00+00'
    )
  $test$,
  '%permission denied for function check_rate_limit%',
  'authenticated cannot execute the security-invoker rate-limit RPC'
);
select throws_like(
  $test$
    select * from public.finalize_rate_limit_attempt(
      '00000000-0000-4000-8000-000000000005',
      'authenticated-key',
      'login_phone',
      'release',
      timestamptz '2026-08-04 03:00:00+00'
    )
  $test$,
  '%permission denied for function finalize_rate_limit_attempt%',
  'authenticated cannot execute the atomic finalization RPC'
);

reset role;

select is(
  current_user,
  session_user,
  'role tests safely restore the pgTAP owner role'
);

select * from finish();
rollback;
