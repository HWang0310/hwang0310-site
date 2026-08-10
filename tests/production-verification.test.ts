import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_PATHS, PUBLIC_PATHS, runProductionProbe } from "../scripts/verify-income-forecast-production.mjs";

const scriptPath = resolve("scripts/verify-income-forecast-production.mjs");

describe("production verification probe contract", () => {
  it("checks both public dates and private report boundaries", () => {
    const source = readFileSync(scriptPath, "utf8");
    for (const date of ["20260720", "20260725", "20260724", "20260726"]) {
      expect(source).toContain(date);
    }
    expect(source).toContain("匿名");
    expect(source).toContain("INCOME_FORECAST_TEST_PHONE");
    expect(source).toContain("INCOME_FORECAST_TEST_PASSWORD");
  });

  it("never prints credentials, cookies, tokens, or response bodies", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("logger(`匿名 ${path} -> ${safeStatus(status)}`)");
    expect(source).toContain("logger(`测试登录 -> ${safeStatus(loginStatus)}`)");
    expect(source).not.toMatch(/logger\([^\n]*(?:phone|password|cookie|token|email)/iu);
    expect(source).not.toMatch(/logger\([^\n]*(?:response\.(?:text|json)|body)/iu);
    expect(source).not.toContain("set-cookie");
  });

  it("defaults to anonymous status-only checks and rejects a public private path", async () => {
    const originalPhone = process.env.INCOME_FORECAST_TEST_PHONE;
    const originalPassword = process.env.INCOME_FORECAST_TEST_PASSWORD;
    delete process.env.INCOME_FORECAST_TEST_PHONE;
    delete process.env.INCOME_FORECAST_TEST_PASSWORD;
    const requests: Array<{ path: string; method: string }> = [];
    const logs: string[] = [];

    try {
      const result = await runProductionProbe({
        origin: "https://example.test",
        logger: (line) => logs.push(line),
        fetchImpl: async (input, init) => {
          const path = new URL(String(input)).pathname;
          requests.push({ path, method: init?.method ?? "GET" });
          return new Response(null, { status: 200 });
        },
      });

      expect(result.ok).toBe(false);
      expect(requests).toHaveLength(PUBLIC_PATHS.length + PRIVATE_PATHS.length);
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
      expect(logs).toHaveLength(requests.length);
      expect(logs.every((line) => /^匿名 .* -> \d+$/u.test(line))).toBe(true);
    } finally {
      if (originalPhone === undefined) delete process.env.INCOME_FORECAST_TEST_PHONE;
      else process.env.INCOME_FORECAST_TEST_PHONE = originalPhone;
      if (originalPassword === undefined) delete process.env.INCOME_FORECAST_TEST_PASSWORD;
      else process.env.INCOME_FORECAST_TEST_PASSWORD = originalPassword;
    }
  });
});
