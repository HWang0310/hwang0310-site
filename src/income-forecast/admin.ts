import "./styles.css";
import { apiRequest, IncomeApiError, INCOME_ROOT } from "./income-api";

type AdminUser = Readonly<{
  id: string;
  fullName: string;
  employeeNo: string;
  phone: string;
  email: string;
  role: string;
  active: boolean;
  usesInitialPassword: boolean;
  mustChangePassword: boolean;
}>;

type AdminReport = Readonly<{
  date: string;
  title: string;
  visibility: "public" | "private";
  pinned: boolean;
  status: "staging" | "online" | "offline";
  sizeBytes: number;
  fileCount: number;
  online: boolean;
  publishedAt: string | null;
  cleanedAt: string | null;
}>;

type AdminReportsPayload = Readonly<{
  reports: AdminReport[];
  privateUsedBytes: number;
  onlineTotalBytes: number;
  softLimitBytes: number;
  freeTierReferenceBytes: number;
  nextEvictionDate: string | null;
  lastCleanup: string | null;
}>;

type AdminAuditEvent = Readonly<{
  id: number;
  eventType: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  success: boolean;
  metadata: unknown;
  createdAt: string;
}>;

const ADMIN_ROOT = `${INCOME_ROOT}admin/`;
const ADMIN_USERS = `${INCOME_ROOT}api/admin/users`;
const ADMIN_REPORTS = `${INCOME_ROOT}api/admin/reports`;
const ADMIN_AUDIT = `${INCOME_ROOT}api/admin/audit?page=1&pageSize=50`;

function query<T extends Element>(selector: string): T | null {
  return typeof document === "undefined" ? null : document.querySelector<T>(selector);
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function bytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KiB`;
  return `${Math.round(value)} B`;
}

function dateLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || !/^\d{8}$/u.test(value)) return "—";
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function setText(selector: string, value: string): void {
  const element = query<HTMLElement>(selector);
  if (element !== null) element.textContent = value;
}

function actionButton(label: string, action: string, id: string, danger = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "if-text-button if-danger-button" : "if-text-button";
  button.dataset.action = action;
  button.dataset.targetId = id;
  if (danger) button.dataset.dangerAction = "true";
  button.textContent = label;
  return button;
}

function renderUsers(users: readonly AdminUser[]): void {
  const body = query<HTMLTableSectionElement>("[data-admin-users-body]");
  if (body === null) return;
  body.replaceChildren();
  setText("[data-admin-user-count]", `${users.length} 位成员`);
  for (const user of users) {
    const row = document.createElement("tr");
    const member = document.createElement("td");
    member.innerHTML = `<strong></strong><small></small>`;
    const strong = member.querySelector("strong");
    const small = member.querySelector("small");
    if (strong !== null) strong.textContent = user.fullName;
    if (small !== null) small.textContent = `${user.employeeNo} · ${user.mustChangePassword ? "下次登录需改密" : user.usesInitialPassword ? "仍为初始密码" : "已设置密码"}`;
    const contact = document.createElement("td");
    contact.innerHTML = `<small></small><small></small>`;
    const contactLines = contact.querySelectorAll("small");
    if (contactLines[0] !== undefined) contactLines[0].textContent = user.phone;
    if (contactLines[1] !== undefined) contactLines[1].textContent = user.email;
    const role = document.createElement("td");
    role.textContent = user.role === "root_admin" ? "最高管理员" : user.role === "admin" ? "管理员" : "成员";
    const state = document.createElement("td");
    state.textContent = user.active ? "启用" : "已停用";
    state.className = user.active ? "if-state-good" : "if-state-muted";
    const actions = document.createElement("td");
    actions.className = "if-admin-actions";
    if (user.active) actions.appendChild(actionButton("停用", "set_active:false", user.id, true));
    else actions.appendChild(actionButton("启用", "set_active:true", user.id));
    actions.appendChild(actionButton("发送重置", "send_reset", user.id));
    actions.appendChild(actionButton(user.mustChangePassword ? "取消改密提醒" : "要求改密", `require_password_change:${String(!user.mustChangePassword)}`, user.id));
    row.appendChild(member);
    row.appendChild(contact);
    row.appendChild(role);
    row.appendChild(state);
    row.appendChild(actions);
    body.appendChild(row);
  }
}

function renderReports(payload: AdminReportsPayload): void {
  setText("[data-admin-report-count]", `${payload.reports.length} 期记录`);
  setText("[data-capacity-private]", bytes(payload.privateUsedBytes));
  setText("[data-capacity-total]", bytes(payload.onlineTotalBytes));
  setText("[data-capacity-next]", dateLabel(payload.nextEvictionDate));
  setText("[data-capacity-cleanup]", dateLabel(payload.lastCleanup));
  const container = query<HTMLElement>("[data-admin-reports-body]");
  if (container === null) return;
  container.replaceChildren();
  for (const report of payload.reports) {
    const item = document.createElement("article");
    item.className = "if-admin-report-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${dateLabel(report.date)} · ${report.title}`;
    const detail = document.createElement("small");
    detail.textContent = `${report.visibility === "public" ? "公开示例" : "私有报告"} · ${report.status === "online" ? "在线" : "已下线"} · ${bytes(report.sizeBytes)}`;
    copy.appendChild(title);
    copy.appendChild(detail);
    const actions = document.createElement("div");
    actions.className = "if-admin-actions";
    if (report.visibility === "public") {
      const protectedLabel = document.createElement("span");
      protectedLabel.className = "if-protected-label";
      protectedLabel.textContent = "永久保护";
      actions.appendChild(protectedLabel);
    } else {
      actions.appendChild(actionButton(report.pinned ? "取消置顶" : "置顶", `set_pinned:${String(!report.pinned)}`, report.date));
      if (report.status === "online") actions.appendChild(actionButton("下线", "set_offline", report.date, true));
    }
    item.appendChild(copy);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

function renderAudit(events: readonly AdminAuditEvent[], page: number): void {
  setText("[data-admin-audit-page]", `第 ${page} 页 · ${events.length} 条`);
  const body = query<HTMLTableSectionElement>("[data-admin-audit-body]");
  if (body === null) return;
  body.replaceChildren();
  for (const event of events) {
    const row = document.createElement("tr");
    const time = document.createElement("td");
    time.textContent = new Date(event.createdAt).toLocaleString("zh-CN", { hour12: false });
    const action = document.createElement("td");
    action.textContent = event.eventType;
    const target = document.createElement("td");
    target.textContent = `${text(event.targetType)} · ${text(event.targetId)}`;
    const result = document.createElement("td");
    result.textContent = event.success ? "成功" : "失败";
    result.className = event.success ? "if-state-good" : "if-state-danger";
    row.appendChild(time);
    row.appendChild(action);
    row.appendChild(target);
    row.appendChild(result);
    body.appendChild(row);
  }
}

async function mutateUser(id: string, action: Record<string, unknown>): Promise<void> {
  await apiRequest(`${ADMIN_USERS}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(action) });
  await loadAdminData();
}

async function mutateReport(date: string, action: Record<string, unknown>): Promise<void> {
  await apiRequest(`${ADMIN_REPORTS}/${encodeURIComponent(date)}`, { method: "PATCH", body: JSON.stringify(action) });
  await loadAdminData();
}

function dangerousConfirm(message: string): boolean {
  return typeof window === "undefined" || window.confirm(message);
}

async function handleAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.action ?? "";
  const id = button.dataset.targetId ?? "";
  if (id.length === 0 || action.length === 0) return;
  if (button.dataset.dangerAction === "true" && !dangerousConfirm("这项操作会改变在线访问状态，确定继续吗？")) return;
  button.disabled = true;
  try {
    if (action.startsWith("set_active:")) await mutateUser(id, { action: "set_active", active: action.endsWith("true") });
    else if (action === "send_reset") await mutateUser(id, { action });
    else if (action.startsWith("require_password_change:")) await mutateUser(id, { action: "require_password_change", required: action.endsWith("true") });
    else if (action.startsWith("set_pinned:")) await mutateReport(id, { action: "set_pinned", pinned: action.endsWith("true") });
    else if (action === "set_offline") await mutateReport(id, { action });
  } catch (error) {
    setText("[data-admin-error]", error instanceof Error ? error.message : "操作失败，请稍后再试。");
  } finally {
    button.disabled = false;
  }
}

async function loadAdminData(): Promise<void> {
  const [usersPayload, reportsPayload, auditPayload] = await Promise.all([
    apiRequest<{ users: AdminUser[] }>(ADMIN_USERS),
    apiRequest<AdminReportsPayload>(ADMIN_REPORTS),
    apiRequest<{ events: AdminAuditEvent[]; page: number }>(ADMIN_AUDIT),
  ]);
  renderUsers(usersPayload.users);
  renderReports(reportsPayload);
  renderAudit(auditPayload.events, auditPayload.page);
  setText("[data-admin-status]", "管理员会话 · 数据已同步");
}

export async function bootstrapAdminWorkbench(): Promise<void> {
  if (typeof document === "undefined") return;
  document.querySelector("[data-admin-app]")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.action) return;
    void handleAction(target);
  });
  try {
    await loadAdminData();
  } catch (error) {
    const message = error instanceof IncomeApiError && error.status === 403
      ? "当前账号没有管理员权限。"
      : error instanceof IncomeApiError && error.status === 401
        ? "登录已过期，请先登录报告入口。"
        : error instanceof Error
          ? error.message
          : "管理数据暂时无法加载。";
    setText("[data-admin-status]", "访问受限");
    setText("[data-admin-error]", message);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrapAdminWorkbench(), { once: true });
  else void bootstrapAdminWorkbench();
}

export { loadAdminData, renderUsers, renderReports, renderAudit };
