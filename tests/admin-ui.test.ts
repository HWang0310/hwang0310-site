import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const htmlPath = resolve(root, "projects/income-forecast/admin/index.html");
const scriptPath = resolve(root, "src/income-forecast/admin.ts");

describe("income forecast administrator workbench", () => {
  it("contains people, reports, capacity, and audit areas", () => {
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain("data-admin-users");
    expect(html).toContain("data-admin-reports");
    expect(html).toContain("data-admin-capacity");
    expect(html).toContain("data-admin-audit");
    expect(html).toContain("/projects/income-forecast/");
  });

  it("uses confirmation for dangerous actions and never exposes password inputs", () => {
    const html = readFileSync(htmlPath, "utf8");
    const script = readFileSync(scriptPath, "utf8");
    expect(html).toContain("data-danger-action");
    expect(script).toMatch(/confirm\s*\(/u);
    expect(html).not.toMatch(/type=["']password["']/iu);
    expect(script).not.toMatch(/encrypted_password|password_hash|access_token|refresh_token|jwt/iu);
  });

  it("has a dedicated Vite entry and is not bundled into the homepage", () => {
    const vite = readFileSync(resolve(root, "vite.config.ts"), "utf8");
    expect(vite).toContain("incomeForecastAdmin");
    expect(vite).toContain("projects/income-forecast/admin/index.html");
  });
});
