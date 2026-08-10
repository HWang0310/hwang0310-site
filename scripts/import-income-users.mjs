import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

export const DEFAULT_ROSTER_PATH = "/Users/hwang/Movies/Program/hwang_sryg/收入预估2.0人员权限清单.xlsx";
export const ROSTER_HEADERS = Object.freeze(["姓名", "工号", "电话号码", "邮箱", "是否管理员"]);
const PHONE_PATTERN = /^1\d{10}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_ROWS = 2_000;

/** @typedef {"user"|"admin"|"root_admin"} AppRole */

/**
 * @typedef {Object} RosterPerson
 * @property {string} name
 * @property {string} employeeNo
 * @property {string} phone
 * @property {string} email
 * @property {boolean} isAdmin
 * @property {AppRole} role
 */

function invalid(message) {
  const error = new Error(message);
  error.name = "RosterValidationError";
  return error;
}

function compact(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : String(value ?? "").trim();
}

function maskPhone(value) {
  return PHONE_PATTERN.test(value) ? `${value.slice(0, 3)}****${value.slice(-2)}` : "手机号已隐藏";
}

function maskEmail(value) {
  const at = value.lastIndexOf("@");
  if (at <= 0) return "邮箱已隐藏";
  return `${value.slice(0, Math.min(2, at))}***@${value.slice(at + 1)}`;
}

function displayConflict(kind, value) {
  if (kind === "手机号") return `${kind}冲突：${maskPhone(value)}`;
  if (kind === "邮箱") return `${kind}冲突：${maskEmail(value)}`;
  return `${kind}冲突`;
}

function rowCells(row) {
  const values = Array.isArray(row.values) ? row.values.slice(1) : [];
  while (values.length > 0 && (values.at(-1) === null || values.at(-1) === undefined || values.at(-1) === "")) values.pop();
  return values;
}

function rowIsEmpty(cells) {
  return cells.length === 0 || cells.every((value) => value === null || value === undefined || compact(value) === "");
}

function parseAdminFlag(value) {
  const text = compact(value).toLowerCase();
  if (["是", "y", "yes", "true", "1", "管理员"].includes(text)) return true;
  if (["否", "n", "no", "false", "0", "普通用户", "成员"].includes(text)) return false;
  throw invalid("是否管理员必须填写是或否");
}

function parsePerson(cells, rowNumber) {
  if (cells.length !== ROSTER_HEADERS.length) throw invalid(`第 ${rowNumber} 行字段数量无效`);
  const name = compact(cells[0]).normalize("NFC");
  const employeeNo = compact(cells[1]);
  const phone = compact(cells[2]).replace(/[\s-]/gu, "");
  const email = compact(cells[3]).toLowerCase();
  if (name.length === 0 || name.length > 80) throw invalid(`第 ${rowNumber} 行姓名无效`);
  if (employeeNo.length === 0 || employeeNo.length > 80 || /[\u0000-\u001f\u007f]/u.test(employeeNo)) throw invalid(`第 ${rowNumber} 行工号无效`);
  if (!PHONE_PATTERN.test(phone)) throw invalid(`第 ${rowNumber} 行手机号无效：${maskPhone(phone)}`);
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw invalid(`第 ${rowNumber} 行邮箱无效：${maskEmail(email)}`);
  const isAdmin = parseAdminFlag(cells[4]);
  if (name === "王昊" && !isAdmin) throw invalid("王昊必须标记为管理员");
  return {
    name,
    employeeNo,
    phone,
    email,
    isAdmin,
    role: name === "王昊" && isAdmin ? "root_admin" : isAdmin ? "admin" : "user",
  };
}

function ensureUnique(people, field, label, normalize = (value) => value) {
  const seen = new Set();
  for (const person of people) {
    const value = normalize(person[field]);
    if (seen.has(value)) throw invalid(displayConflict(label, person[field]));
    seen.add(value);
  }
}

function validateRoster(people) {
  if (people.length === 0) throw invalid("人员清单不能为空");
  if (people.length > MAX_ROWS) throw invalid("人员清单行数超过上限");
  ensureUnique(people, "employeeNo", "工号");
  ensureUnique(people, "phone", "手机号");
  ensureUnique(people, "email", "邮箱", (value) => value.toLowerCase());
  const rootAdmins = people.filter((person) => person.role === "root_admin");
  if (rootAdmins.length !== 1) throw invalid("人员清单必须且只能有一名王昊最高管理员");
  return people;
}

/** Reads and validates the exact roster shape without contacting Supabase. */
export async function readRoster(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    throw invalid("无法读取人员清单");
  }
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw invalid("人员清单缺少工作表");
  const headers = rowCells(sheet.getRow(1));
  if (headers.length !== ROSTER_HEADERS.length || headers.some((value, index) => value !== ROSTER_HEADERS[index])) {
    throw invalid("人员清单表头必须精确为：姓名、工号、电话号码、邮箱、是否管理员");
  }
  const people = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const cells = rowCells(sheet.getRow(rowNumber));
    if (rowIsEmpty(cells)) continue;
    people.push(parsePerson(cells, rowNumber));
  }
  return validateRoster(people);
}

function ensureClient(client) {
  if (client === null || typeof client !== "object" || client.auth?.admin === undefined || typeof client.from !== "function") {
    throw new Error("缺少 Supabase 服务客户端");
  }
}

async function listAuthUsers(client) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await client.auth.admin.listUsers({ page, perPage: 1_000 });
    if (response?.error !== null) throw new Error("无法读取现有账号");
    const pageUsers = Array.isArray(response?.data?.users) ? response.data.users : [];
    users.push(...pageUsers);
    if (pageUsers.length < 1_000) break;
  }
  return users;
}

async function listExistingProfiles(client, phones) {
  if (phones.length === 0) return [];
  const query = client.from("profiles");
  if (typeof query?.select !== "function") return [];
  const selected = query.select("user_id,phone,uses_initial_password,must_change_password");
  if (typeof selected?.in !== "function") return [];
  const response = await selected.in("phone", phones);
  if (response?.error !== null) throw new Error("无法读取现有人员配置");
  return Array.isArray(response?.data) ? response.data : [];
}

async function upsertProfile(client, person, userId, existingAuthUser, existingProfile) {
  const payload = {
    user_id: userId,
    full_name: person.name,
    employee_no: person.employeeNo,
    phone: person.phone,
    email: person.email,
    role: person.role,
  };
  if (existingAuthUser === undefined) {
    payload.is_active = true;
    payload.uses_initial_password = true;
    payload.must_change_password = false;
  } else if (existingProfile !== undefined) {
    payload.uses_initial_password = existingProfile.uses_initial_password;
    payload.must_change_password = existingProfile.must_change_password;
  }
  const response = await client.from("profiles").upsert(payload, { onConflict: "user_id" });
  if (response?.error !== null) throw new Error("无法同步人员配置");
}

/**
 * Dry-run never calls the client. Apply creates missing Auth users with phone
 * as the initial password and updates existing users without changing it.
 */
export async function syncRoster(client, people, { apply = false } = {}) {
  validateRoster(people);
  const summary = {
    peopleCount: people.length,
    adminCount: people.filter((person) => person.isAdmin).length,
    plannedCreateCount: apply ? 0 : people.length,
    plannedUpdateCount: 0,
    createdCount: 0,
    updatedCount: 0,
    conflicts: [],
  };
  if (!apply) return summary;
  ensureClient(client);
  const authUsers = await listAuthUsers(client);
  const authByPhone = new Map(authUsers.filter((user) => typeof user.phone === "string").map((user) => [user.phone, user]));
  const profileRows = await listExistingProfiles(client, people.map((person) => person.phone));
  const profileByPhone = new Map(profileRows.filter((profile) => typeof profile.phone === "string").map((profile) => [profile.phone, profile]));

  for (const person of people) {
    const existing = authByPhone.get(person.phone);
    let userId;
    if (existing === undefined) {
      const response = await client.auth.admin.createUser({
        phone: person.phone,
        email: person.email,
        password: person.phone,
        phone_confirm: true,
        email_confirm: true,
        app_metadata: { role: person.role },
      });
      if (response?.error !== null || response?.data?.user?.id === undefined) throw new Error("无法创建人员账号");
      userId = response.data.user.id;
      summary.createdCount += 1;
    } else {
      userId = existing.id;
      const response = await client.auth.admin.updateUserById(userId, {
        email: person.email,
        phone: person.phone,
        phone_confirm: true,
        email_confirm: true,
        app_metadata: { role: person.role },
      });
      if (response?.error !== null) throw new Error("无法同步现有人员账号");
      summary.updatedCount += 1;
    }
    await upsertProfile(client, person, userId, existing, profileByPhone.get(person.phone));
  }
  summary.plannedCreateCount = summary.createdCount;
  summary.plannedUpdateCount = summary.updatedCount;
  return summary;
}

export function formatRosterSummary(summary) {
  return `人员 ${summary.peopleCount} 人 · 管理员 ${summary.adminCount} 人 · 待创建 ${summary.plannedCreateCount} · 待更新 ${summary.plannedUpdateCount}`;
}

function parseArgs(argv) {
  let rosterPath = DEFAULT_ROSTER_PATH;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") apply = true;
    else if (argument === "--roster") {
      rosterPath = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write("用法：node scripts/import-income-users.mjs [--roster 文件] [--apply]\n");
      return null;
    } else {
      throw new Error("参数无效");
    }
  }
  if (rosterPath.length === 0) throw new Error("缺少人员清单路径");
  return { rosterPath, apply };
}

function runtimeClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("--apply 需要 Supabase 服务配置");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options !== null) {
      const people = await readRoster(options.rosterPath);
      const result = await syncRoster(options.apply ? runtimeClient() : null, people, { apply: options.apply });
      process.stdout.write(`${options.apply ? "已同步" : "Dry Run"}：${formatRosterSummary(result)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "人员清单导入失败";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
