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
});
