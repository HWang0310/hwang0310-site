import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("income forecast access-control migration", () => {
  it("defines the complete private-report database security contract", () => {
    const migrations = globSync(
      "supabase/migrations/*_income_forecast_access_control.sql"
    );

    expect(migrations).toHaveLength(1);

    const sql = readFileSync(migrations[0], "utf8").toLowerCase();

    for (const required of [
      "create table public.profiles",
      "create table public.reports",
      "create table public.audit_events",
      "create table public.rate_limits",
      "enable row level security",
      "record_rate_limit_failure",
      "finalize_report_publish",
      "2026-07-20",
      "2026-07-25",
      "revoke all",
    ]) {
      expect(sql).toContain(required);
    }
  });

  it("pins the reviewed rate-limit, locking, role, and rollback fixes", () => {
    const migrations = globSync(
      "supabase/migrations/*_income_forecast_access_control.sql"
    );

    expect(migrations).toHaveLength(1);

    const migration = readFileSync(migrations[0], "utf8").toLowerCase();
    const pgTap = readFileSync(
      "supabase/tests/income_forecast_access_control.sql",
      "utf8"
    ).toLowerCase();

    for (const required of [
      "create function public.check_rate_limit(\n  p_limit_key text,\n  p_action text,\n  p_window_seconds integer,\n  p_max_failures integer,\n  p_block_seconds integer",
      "pg_advisory_xact_lock",
      "with cleaned_reports as (",
      "visibility = 'private'\n      and status = 'online'\n      and not pinned",
    ]) {
      expect(migration).toContain(required);
    }

    expect(migration).not.toContain(
      "when current_limit.failure_count + 1 >= p_max_failures\n        then p_now + make_interval(secs => p_block_seconds)"
    );

    for (const required of [
      "set local role service_role",
      "set local role anon",
      "set local role authenticated",
      "audit_events_actor_user_id_fkey",
      "timestamptz '2026-08-04 00:09:00+00'",
      "whole finalize_report_publish call rolls back",
    ]) {
      expect(pgTap).toContain(required);
    }
  });
});
