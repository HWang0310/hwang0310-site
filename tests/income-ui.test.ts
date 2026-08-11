import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { IncomeReport } from "../src/income-forecast/client";

const entryPath = resolve("projects/income-forecast/index.html");
const resetPath = resolve("projects/income-forecast/reset-password/index.html");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("income forecast progressive-enhancement UI", () => {
  it("uses a Vite entry and removes the legacy public entry", () => {
    expect(existsSync(entryPath)).toBe(true);
    expect(existsSync(resetPath)).toBe(true);
    expect(existsSync(resolve("public/projects/income-forecast/index.html"))).toBe(false);
  });

  it("keeps the two public examples visible without JavaScript", () => {
    const html = read(entryPath);
    expect(html).toContain("湖北电信 · 收入预估");
    expect(html).toContain("手机号");
    expect(html).toContain("密码");
    expect(html).toContain("忘记密码");
    expect(html).toContain("每次发送后需等待60秒才能再次申请，请留意收件箱及垃圾邮件。");
    expect(html).toContain("data-forgot-cooldown");
    expect(html).toContain("/projects/income-forecast/reports/2026/07/20/");
    expect(html).toContain("/projects/income-forecast/reports/2026/07/25/");
    expect(html).not.toContain("/projects/income-forecast/reports/2026/07/24/");
    expect(html).not.toContain("/projects/income-forecast/reports/2026/07/26/");
  });

  it("has labelled login and recovery controls with live status regions", () => {
    const html = read(entryPath);
    for (const marker of [
      'for="phone"',
      'for="password"',
      'id="phone"',
      'id="password"',
      'data-login-form',
      'data-forgot-form',
      'aria-live="polite"',
      'data-report-list',
      'data-change-password',
      'data-change-open',
      'data-report-year',
      'data-report-month',
      'data-report-day',
      'data-report-open',
      'data-report-selection',
      'for="report-year"',
      'for="report-month"',
      'for="report-day"',
    ]) {
      expect(html).toContain(marker);
    }
    expect(html).toMatch(/type=["']password["']/u);
  });

  it("contains a same-origin token-hash reset form and no third-party scripts", () => {
    const html = read(resetPath);
    expect(html).toContain("重置密码");
    expect(html).toContain('data-reset-form');
    expect(html).toContain('id="new-password"');
    expect(html).toContain('id="confirm-password"');
    expect(html).toContain('aria-live="polite"');
    const externalScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/giu)]
      .map((match) => match[1])
      .filter((src) => /^https?:\/\//iu.test(src));
    expect(externalScripts).toEqual([]);
  });

  it("keeps reset bootstrap independent from the entry session bootstrap", () => {
    const resetScript = read(resolve("src/income-forecast/reset-password.ts"));
    expect(resetScript).not.toContain('from "./client"');
    expect(resetScript).not.toContain("api/session");
    expect(resetScript).not.toContain("api/reports");
  });

  it("declares mobile-safe layout constraints and reduced-motion support", () => {
    const css = read(resolve("src/income-forecast/styles.css"));
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toMatch(/min-height:\s*44px/u);
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("overflow-x: hidden");
  });
});

describe("income forecast client policy", () => {
  it("exports a safe next-path helper", async () => {
    const client = await import("../src/income-forecast/client");
    expect(client.safeNextPath("/projects/income-forecast/reports/2026/07/20/")).toBe(
      "/projects/income-forecast/reports/2026/07/20/",
    );
    expect(client.safeNextPath("https://evil.example/steal")).toBe(
      "/projects/income-forecast/",
    );
    expect(client.safeNextPath("//evil.example/steal")).toBe(
      "/projects/income-forecast/",
    );
    expect(client.safeNextPath(null)).toBe("/projects/income-forecast/");
  });

  it("formats report dates without exposing private storage paths", async () => {
    const client = await import("../src/income-forecast/client");
    expect(client.formatReportDate("20260725")).toBe("2026年7月25日");
    expect(client.reportPath("20260725")).toBe(
      "/projects/income-forecast/reports/2026/07/25/",
    );
    expect(client.reportPath("20260724")).not.toContain("supabase");
  });

  it("formats the recovery cooldown without hiding the mailbox reminder", async () => {
    const client = await import("../src/income-forecast/client");
    expect(client.recoveryCooldownText(60)).toBe(
      "请等待60秒后再次申请。请留意收件箱及垃圾邮件。",
    );
    expect(client.recoveryCooldownText(1)).toBe(
      "请等待1秒后再次申请。请留意收件箱及垃圾邮件。",
    );
    expect(client.recoveryCooldownText(0)).toBe(
      "每次发送后需等待60秒才能再次申请，请留意收件箱及垃圾邮件。",
    );
  });

  it("resolves the newest valid year, month, and day from authorized reports", async () => {
    const client = await import("../src/income-forecast/client");
    const reports: IncomeReport[] = [
      {
        date: "20260720",
        webPath: client.reportPath("20260720"),
        visibility: "public",
        pinned: true,
        sizeBytes: 0,
        online: true,
      },
      {
        date: "20260725",
        webPath: client.reportPath("20260725"),
        visibility: "public",
        pinned: true,
        sizeBytes: 0,
        online: true,
      },
      {
        date: "20260731",
        webPath: client.reportPath("20260731"),
        visibility: "private",
        pinned: false,
        sizeBytes: 2_100_000,
        online: true,
      },
      {
        date: "20260802",
        webPath: client.reportPath("20260802"),
        visibility: "private",
        pinned: false,
        sizeBytes: 2_200_000,
        online: true,
      },
      {
        date: "20270103",
        webPath: client.reportPath("20270103"),
        visibility: "private",
        pinned: false,
        sizeBytes: 2_300_000,
        online: true,
      },
    ];

    expect(client.resolveReportPicker(reports)).toMatchObject({
      years: ["2027", "2026"],
      year: "2027",
      months: ["01"],
      month: "01",
      days: ["03"],
      day: "03",
      report: reports[4],
    });

    expect(client.resolveReportPicker(reports, { year: "2026", month: "07" })).toMatchObject({
      year: "2026",
      months: ["08", "07"],
      month: "07",
      days: ["31", "25", "20"],
      day: "31",
      report: reports[2],
    });

    expect(client.resolveReportPicker(reports, {
      year: "1999",
      month: "12",
      day: "31",
    })).toMatchObject({
      year: "2027",
      month: "01",
      day: "03",
      report: reports[4],
    });

    expect(client.resolveReportPicker([])).toEqual({
      years: [],
      months: [],
      days: [],
      year: "",
      month: "",
      day: "",
      report: null,
    });
  });
});

describe("recovery URL policy", () => {
  it("keeps the token in memory while removing it from the address target", async () => {
    const reset = await import("../src/income-forecast/reset-password");
    const token = "a".repeat(48);
    expect(reset.extractRecoveryParams(`?token_hash=${token}&type=recovery`)).toEqual({
      tokenHash: token,
      valid: true,
    });
    expect(reset.recoveryUrlWithoutToken("/projects/income-forecast/reset-password/", "#form")).toBe(
      "/projects/income-forecast/reset-password/#form",
    );
  });
});
