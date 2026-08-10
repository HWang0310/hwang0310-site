import { describe, expect, it, vi } from "vitest";

import {
  removeReportStorageObjects,
  type ReportStorageAdapter,
} from "../functions/_lib/report-storage";

const prefix = "reports/2026/07/24/";

function report(storagePrefix: string | null = prefix) {
  return { reportDate: "20260724", storagePrefix };
}

function adapter(overrides: Partial<ReportStorageAdapter> = {}): ReportStorageAdapter {
  return {
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ data: [], error: null }),
    ...overrides,
  };
}

describe("private income report storage cleanup", () => {
  it("walks folders, treats id=null as a directory, and removes every file", async () => {
    const list = vi.fn(async (path: string) => {
      if (path === prefix) {
        return {
          data: [
            { name: "assets", id: null },
            { name: "index.html", id: "file-1" },
          ],
          error: null,
        };
      }
      if (path === `${prefix}assets/`) {
        return {
          data: [{ name: "report.css", id: "file-2" }],
          error: null,
        };
      }
      throw new Error(`unexpected path ${path}`);
    });
    const remove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));

    await removeReportStorageObjects(report(), adapter({ list, remove }));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([
      `${prefix}index.html`,
      `${prefix}assets/report.css`,
    ]);
  });

  it("paginates before one bounded remove operation", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      name: `file-${index}.html`,
      id: `file-${index}`,
    }));
    const list = vi.fn(async (_path: string, options: { offset: number }) =>
      options.offset === 0
        ? { data: firstPage, error: null }
        : { data: [{ name: "last.html", id: "file-last" }], error: null });
    const remove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));

    await expect(
      removeReportStorageObjects(report(), adapter({ list, remove })),
    ).rejects.toMatchObject({ status: 503 });

    expect(list).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(0);
  });

  it("removes up to the bounded file limit in one call", async () => {
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      name: `file-${index}.html`,
      id: `file-${index}`,
    }));
    const list = vi.fn(async (_path: string, options: { offset: number }) =>
      options.offset === 0 ? { data: entries, error: null } : { data: [], error: null });
    const remove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));

    await removeReportStorageObjects(report(), adapter({ list, remove }));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(entries.map((entry) => `${prefix}${entry.name}`));
  });

  it.each([
    "reports/2026/07/25/",
    "reports/2026/07/24/../",
    "reports/2026/07/24\\escape/",
    "reports/2026/07/24/\u0000bad/",
  ])("rejects unsafe or date-mismatched storage prefixes: %s", async (storagePrefix) => {
    const list = vi.fn(async () => ({ data: [], error: null }));
    await expect(
      removeReportStorageObjects(report(storagePrefix), adapter({ list })),
    ).rejects.toMatchObject({ status: 503 });
    expect(list).not.toHaveBeenCalled();
  });

  it("treats a legacy null prefix as an empty, safe directory", async () => {
    const list = vi.fn(async () => ({ data: [], error: null }));
    const remove = vi.fn(async (paths: string[]) => ({ data: paths, error: null }));
    await removeReportStorageObjects(report(null), adapter({ list, remove }));
    expect(list).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("surfaces list and remove failures as service-unavailable errors", async () => {
    await expect(
      removeReportStorageObjects(
        report(),
        adapter({ list: async () => ({ data: null, error: new Error("list failed") }) }),
      ),
    ).rejects.toMatchObject({ status: 503 });

    await expect(
      removeReportStorageObjects(
        report(),
        adapter({
          list: async () => ({ data: [{ name: "index.html", id: "file-1" }], error: null }),
          remove: async () => ({ data: null, error: new Error("remove failed") }),
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
