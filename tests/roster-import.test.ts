import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import {
  formatRosterSummary,
  readRoster,
  syncRoster,
  type RosterPerson,
} from "../scripts/import-income-users.mjs";

async function workbookFile(
  headers: string[],
  rows: readonly unknown[][],
): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(join(tmpdir(), "income-roster-test-"));
  const file = join(directory, "roster.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("人员");
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  await workbook.xlsx.writeFile(file);
  return { directory, file };
}

const validHeaders = ["姓名", "工号", "电话号码", "邮箱", "是否管理员"];
const validRows = [["王昊", "A001", "13800138000", "wanghao@example.com", "是"], ["李四", "A002", "13900139000", "lisi@example.com", "否"]];

describe("income forecast roster reader", () => {
  it("accepts the exact five-column header and derives root/admin roles", async () => {
    const fixture = await workbookFile(validHeaders, validRows);
    try {
      const people = await readRoster(fixture.file);
      expect(people).toEqual([
        expect.objectContaining({ name: "王昊", employeeNo: "A001", phone: "13800138000", isAdmin: true, role: "root_admin" }),
        expect.objectContaining({ name: "李四", employeeNo: "A002", phone: "13900139000", isAdmin: false, role: "user" }),
      ]);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing header", ["姓名", "工号", "电话号码", "邮箱"]],
    ["duplicate employee number", validHeaders, [["王昊", "A001", "13800138000", "wanghao@example.com", "是"], ["李四", "A001", "13900139000", "lisi@example.com", "否"]]],
    ["duplicate phone", validHeaders, [["王昊", "A001", "13800138000", "wanghao@example.com", "是"], ["李四", "A002", "13800138000", "lisi@example.com", "否"]]],
    ["invalid email", validHeaders, [["王昊", "A001", "13800138000", "not-an-email", "是"], ["李四", "A002", "13900139000", "lisi@example.com", "否"]]],
    ["invalid phone", validHeaders, [["王昊", "A001", "1380013800", "wanghao@example.com", "是"], ["李四", "A002", "13900139000", "lisi@example.com", "否"]]],
    ["missing root administrator", validHeaders, [["张三", "A001", "13800138000", "zhang@example.com", "是"], ["李四", "A002", "13900139000", "lisi@example.com", "否"]]],
  ])("rejects %s", async (_label, headers, rows = validRows) => {
    const fixture = await workbookFile(headers as string[], rows as unknown[][]);
    try {
      await expect(readRoster(fixture.file)).rejects.toThrow();
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("performs no remote calls during the default dry-run sync", async () => {
    const people: RosterPerson[] = [
      { name: "王昊", employeeNo: "A001", phone: "13800138000", email: "wanghao@example.com", isAdmin: true, role: "root_admin" },
      { name: "李四", employeeNo: "A002", phone: "13900139000", email: "lisi@example.com", isAdmin: false, role: "user" },
    ];
    const client = { auth: { admin: { createUser: vi.fn() } }, from: vi.fn() };
    const result = await syncRoster(client, people, { apply: false });
    expect(result).toMatchObject({ peopleCount: 2, adminCount: 1, plannedCreateCount: 2, plannedUpdateCount: 0 });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("creates missing users and updates existing users without resetting passwords", async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const createUser = vi.fn(async (input: Record<string, unknown>) => ({ data: { user: { id: "new-user", phone: input.phone } }, error: null }));
    const updateUserById = vi.fn(async (_id: string, _attributes: Record<string, unknown>) => ({ data: { user: { id: "existing-user" } }, error: null }));
    const client = {
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({ data: { users: [{ id: "existing-user", phone: "13800138000" }] }, error: null })),
          createUser,
          updateUserById,
        },
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [{ user_id: "existing-user", phone: "13800138000", uses_initial_password: false, must_change_password: false }], error: null })) })),
        upsert: vi.fn(async (payload: Record<string, unknown>) => { upserts.push(payload); return { data: null, error: null }; }),
      })),
    };
    const result = await syncRoster(client, validRows.map((row) => ({
      name: row[0], employeeNo: row[1], phone: row[2], email: row[3], isAdmin: row[4] === "是", role: row[0] === "王昊" ? "root_admin" : "user",
    })), { apply: true });
    expect(result).toMatchObject({ createdCount: 1, updatedCount: 1 });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser.mock.calls[0]?.[0]).toMatchObject({ phone: "13900139000", password: "13900139000", app_metadata: { role: "user" } });
    expect(updateUserById.mock.calls[0]?.[1]).not.toHaveProperty("password");
    expect(upserts).toHaveLength(2);
  });

  it("does not include complete PII in a formatted summary", async () => {
    const fixture = await workbookFile(validHeaders, validRows);
    try {
      const content = await readFile(fixture.file);
      expect(content.byteLength).toBeGreaterThan(0);
      const summary = formatRosterSummary({ peopleCount: 2, adminCount: 1, plannedCreateCount: 2, plannedUpdateCount: 0 });
      expect(summary).not.toContain("13800138000");
      expect(summary).not.toContain("wanghao@example.com");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
