import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_STORAGE_SOFT_LIMIT_BYTES,
  PUBLIC_REPORT_DATES,
} from "../shared/income-forecast/contracts";

describe("income forecast public-report policy", () => {
  it("keeps the public report allowlist and private storage soft limit explicit", () => {
    expect(PUBLIC_REPORT_DATES).toEqual(["20260720", "20260725"]);
    expect(PRIVATE_STORAGE_SOFT_LIMIT_BYTES).toBe(850 * 1024 * 1024);
  });

  it("marks only allowlisted reports public and pinned in the archive", () => {
    const archive = JSON.parse(
      readFileSync(resolve("data/report-archive.json"), "utf8")
    ) as Array<{ date: string; visibility: string; pinned: boolean }>;

    expect(
      archive
        .filter((entry) => entry.visibility === "public" && entry.pinned)
        .map((entry) => entry.date)
    ).toEqual(["20260720", "20260725"]);
  });
});
