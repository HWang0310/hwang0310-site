import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
