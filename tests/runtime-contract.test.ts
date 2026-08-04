import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("runtime contract", () => {
  it("pins the Pages and Supabase toolchain", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    expect(pkg.dependencies["@supabase/supabase-js"]).toBe("2.112.0");
    expect(pkg.devDependencies.wrangler).toBe("4.118.0");
    expect(pkg.devDependencies.supabase).toBe("2.111.0");
    expect(pkg.devDependencies.exceljs).toBe("4.4.0");
    expect(pkg.devDependencies["@cloudflare/workers-types"]).toBe("5.20260804.1");
    expect(pkg.engines.node).toBe(">=22");
  });
});
