import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_PATHS,
  PUBLIC_PATHS,
  normalizeOrigin,
  runProductionProbe,
} from "../scripts/verify-income-forecast-production.mjs";

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
        origin: "http://localhost:4173",
        allowLoopback: true,
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

  it("accepts only the own production origin unless loopback is explicitly enabled", () => {
    expect(normalizeOrigin("https://hwang0310.dpdns.org")).toBe(
      "https://hwang0310.dpdns.org",
    );
    expect(() => normalizeOrigin("https://example.test")).toThrow(/origin/u);
    expect(() => normalizeOrigin("http://localhost:4173")).toThrow(/origin/u);
    expect(normalizeOrigin("http://localhost:4173", { allowLoopback: true })).toBe(
      "http://localhost:4173",
    );
  });

  it("does not send optional credentials from a non-owned loopback origin", async () => {
    const originalPhone = process.env.INCOME_FORECAST_TEST_PHONE;
    const originalPassword = process.env.INCOME_FORECAST_TEST_PASSWORD;
    process.env.INCOME_FORECAST_TEST_PHONE = "00000000000";
    process.env.INCOME_FORECAST_TEST_PASSWORD = "test-only-password";
    const requests: Array<{ path: string; method: string; headers: Headers }> = [];

    try {
      await runProductionProbe({
        origin: "http://localhost:4173",
        allowLoopback: true,
        logger: () => undefined,
        fetchImpl: async (input, init) => {
          requests.push({
            path: new URL(String(input)).pathname,
            method: init?.method ?? "GET",
            headers: new Headers(init?.headers),
          });
          return new Response(null, { status: 200 });
        },
      });
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
      expect(requests.some(({ path }) => path.endsWith("/api/session"))).toBe(false);
    } finally {
      if (originalPhone === undefined) delete process.env.INCOME_FORECAST_TEST_PHONE;
      else process.env.INCOME_FORECAST_TEST_PHONE = originalPhone;
      if (originalPassword === undefined) delete process.env.INCOME_FORECAST_TEST_PASSWORD;
      else process.env.INCOME_FORECAST_TEST_PASSWORD = originalPassword;
    }
  });

  it("sends the same-origin Origin header for an optional production login", async () => {
    const originalPhone = process.env.INCOME_FORECAST_TEST_PHONE;
    const originalPassword = process.env.INCOME_FORECAST_TEST_PASSWORD;
    process.env.INCOME_FORECAST_TEST_PHONE = "00000000000";
    process.env.INCOME_FORECAST_TEST_PASSWORD = "test-only-password";
    let loginRequest: { method: string; headers: Headers } | undefined;

    try {
      const result = await runProductionProbe({
        origin: "https://hwang0310.dpdns.org",
        logger: () => undefined,
        fetchImpl: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/api/session")) {
            loginRequest = {
              method: init?.method ?? "GET",
              headers: new Headers(init?.headers),
            };
          }
          return new Response(null, { status: PRIVATE_PATHS.includes(path) ? 404 : 200 });
        },
      });

      expect(result.ok).toBe(true);
      expect(loginRequest?.method).toBe("POST");
      expect(loginRequest?.headers.get("origin")).toBe("https://hwang0310.dpdns.org");
    } finally {
      if (originalPhone === undefined) delete process.env.INCOME_FORECAST_TEST_PHONE;
      else process.env.INCOME_FORECAST_TEST_PHONE = originalPhone;
      if (originalPassword === undefined) delete process.env.INCOME_FORECAST_TEST_PASSWORD;
      else process.env.INCOME_FORECAST_TEST_PASSWORD = originalPassword;
    }
  });
});
