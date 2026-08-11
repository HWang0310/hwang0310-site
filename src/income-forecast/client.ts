import "./styles.css";
import {
  apiRequest,
  IncomeApiError,
  INCOME_ROOT,
  type IncomeSession,
} from "./income-api";
const REPORT_ROOT = `${INCOME_ROOT}reports/`;
const RECOVERY_COOLDOWN_SECONDS = 60;
const RECOVERY_REMINDER = "每次发送后需等待60秒才能再次申请，请留意收件箱及垃圾邮件。";

export type IncomeReport = Readonly<{
  date: string;
  webPath: string;
  visibility: "public" | "private";
  pinned: boolean;
  sizeBytes: number;
  online: boolean;
}>;

export type ReportPickerState = Readonly<{
  years: readonly string[];
  months: readonly string[];
  days: readonly string[];
  year: string;
  month: string;
  day: string;
  report: IncomeReport | null;
}>;

type ApiErrorPayload = Readonly<{
  error?: unknown;
  status?: unknown;
  message?: unknown;
  retryAfterSeconds?: unknown;
}>;

export { IncomeApiError } from "./income-api";
export type { IncomeSession } from "./income-api";

/**
 * Mirrors the server-side next-path policy. Only paths under this app can be
 * returned to after login; absolute and protocol-relative URLs are rejected.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return INCOME_ROOT;
  }

  try {
    const url = new URL(value, "https://income-forecast.invalid");
    let decodedPath = url.pathname;
    for (let pass = 0; pass < 3; pass += 1) {
      const decoded = decodeURIComponent(decodedPath);
      if (decoded === decodedPath) break;
      decodedPath = decoded;
    }
    const normalizedPath = new URL(decodedPath, "https://income-forecast.invalid").pathname;
    if (
      url.origin !== "https://income-forecast.invalid" ||
      /[\\\u0000-\u001f\u007f]/u.test(decodedPath) ||
      (normalizedPath !== INCOME_ROOT.slice(0, -1) && !normalizedPath.startsWith(INCOME_ROOT))
    ) {
      return INCOME_ROOT;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return INCOME_ROOT;
  }
}

export function reportPath(date: string): string {
  if (!/^\d{8}$/u.test(date)) return INCOME_ROOT;
  return `${REPORT_ROOT}${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}/`;
}

export function formatReportDate(date: string): string {
  if (!/^\d{8}$/u.test(date)) return "未知日期";
  return `${date.slice(0, 4)}年${Number(date.slice(4, 6))}月${Number(date.slice(6, 8))}日`;
}

export function recoveryCooldownText(seconds: number): string {
  const remaining = Number.isFinite(seconds)
    ? Math.max(0, Math.ceil(seconds))
    : 0;
  return remaining > 0
    ? `请等待${remaining}秒后再次申请。请留意收件箱及垃圾邮件。`
    : RECOVERY_REMINDER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}


function query<T = HTMLElement>(selector: string): T | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(selector) as T | null;
}

function setHidden(element: Element | null, hidden: boolean): void {
  if (element instanceof HTMLElement) element.hidden = hidden;
}

function setStatus(element: Element | null, message: string, tone?: "error" | "success"): void {
  if (!(element instanceof HTMLElement)) return;
  element.textContent = message;
  if (tone === undefined) element.removeAttribute("data-tone");
  else element.dataset.tone = tone;
}

function formValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

function safeReportFromUnknown(value: unknown): IncomeReport | null {
  if (!isRecord(value)) return null;
  const date = typeof value.date === "string" ? value.date : "";
  const webPath = typeof value.webPath === "string" ? value.webPath : "";
  if (!/^\d{8}$/u.test(date) || webPath !== reportPath(date)) return null;
  if (value.visibility !== "public" && value.visibility !== "private") return null;
  return {
    date,
    webPath,
    visibility: value.visibility,
    pinned: value.pinned === true,
    sizeBytes: Number.isSafeInteger(value.sizeBytes) ? Number(value.sizeBytes) : 0,
    online: value.online === true,
  };
}

function formatSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "在线报告";
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function descendingUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => right.localeCompare(left));
}

export function resolveReportPicker(
  reports: readonly IncomeReport[],
  requested: Readonly<{ year?: string; month?: string; day?: string }> = {},
): ReportPickerState {
  const available = [...reports]
    .filter((report) => report.online && /^\d{8}$/u.test(report.date))
    .sort((left, right) => right.date.localeCompare(left.date));
  const years = descendingUnique(available.map((report) => report.date.slice(0, 4)));
  const year = requested.year !== undefined && years.includes(requested.year)
    ? requested.year
    : years[0] ?? "";
  const reportsInYear = available.filter((report) => report.date.startsWith(year));
  const months = descendingUnique(reportsInYear.map((report) => report.date.slice(4, 6)));
  const month = requested.month !== undefined && months.includes(requested.month)
    ? requested.month
    : months[0] ?? "";
  const reportsInMonth = reportsInYear.filter(
    (report) => report.date.slice(4, 6) === month,
  );
  const days = descendingUnique(reportsInMonth.map((report) => report.date.slice(6, 8)));
  const day = requested.day !== undefined && days.includes(requested.day)
    ? requested.day
    : days[0] ?? "";
  const report = reportsInMonth.find((candidate) => candidate.date === `${year}${month}${day}`) ?? null;
  return { years, months, days, year, month, day, report };
}

let availableReports: readonly IncomeReport[] = [];

function fillReportSelect(
  select: HTMLSelectElement | null,
  values: readonly string[],
  selected: string,
  suffix: "年" | "月" | "日",
): void {
  if (select === null) return;
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = suffix === "年" ? `${value}${suffix}` : `${Number(value)}${suffix}`;
    option.selected = value === selected;
    return option;
  }));
  select.disabled = values.length === 0;
}

function renderReportPicker(
  requested: Readonly<{ year?: string; month?: string; day?: string }> = {},
): void {
  const state = resolveReportPicker(availableReports, requested);
  fillReportSelect(query<HTMLSelectElement>("[data-report-year]"), state.years, state.year, "年");
  fillReportSelect(query<HTMLSelectElement>("[data-report-month]"), state.months, state.month, "月");
  fillReportSelect(query<HTMLSelectElement>("[data-report-day]"), state.days, state.day, "日");

  const selection = query<HTMLElement>("[data-report-selection]");
  const open = query<HTMLAnchorElement>("[data-report-open]");
  if (state.report === null) {
    if (selection !== null) selection.textContent = "暂无可用报告";
    setStatus(query("[data-reports-status]"), "暂无可用报告");
    if (open !== null) {
      open.removeAttribute("href");
      open.setAttribute("aria-disabled", "true");
      open.tabIndex = -1;
    }
    return;
  }

  setStatus(query("[data-reports-status]"), "");

  if (selection !== null) {
    const access = state.report.visibility === "private" ? "权限报告" : "公开示例";
    selection.textContent = `${formatReportDate(state.report.date)} · ${access} · ${formatSize(state.report.sizeBytes)}`;
  }
  if (open !== null) {
    open.href = state.report.webPath;
    open.removeAttribute("aria-disabled");
    open.tabIndex = 0;
  }
}

function renderReports(reports: readonly IncomeReport[]): void {
  const count = query<HTMLElement>("[data-report-count]");
  availableReports = [...reports];
  if (count !== null) count.textContent = `${availableReports.length} 期在线报告`;
  renderReportPicker();
}

function bindReportPicker(): void {
  const year = query<HTMLSelectElement>("[data-report-year]");
  const month = query<HTMLSelectElement>("[data-report-month]");
  const day = query<HTMLSelectElement>("[data-report-day]");
  year?.addEventListener("change", () => renderReportPicker({ year: year.value }));
  month?.addEventListener("change", () => renderReportPicker({
    year: year?.value,
    month: month.value,
  }));
  day?.addEventListener("change", () => renderReportPicker({
    year: year?.value,
    month: month?.value,
    day: day.value,
  }));
}

async function loadReports(): Promise<IncomeReport[]> {
  const payload = await apiRequest<unknown>(`${INCOME_ROOT}api/reports`);
  if (!isRecord(payload) || !Array.isArray(payload.reports)) return [];
  return payload.reports
    .map(safeReportFromUnknown)
    .filter((report): report is IncomeReport => report !== null && report.online);
}

function navigateAfterLogin(next: unknown): void {
  const target = safeNextPath(next);
  if (target === INCOME_ROOT || typeof window === "undefined") return;
  try {
    window.location.assign(target);
  } catch {
    // A browser may reject navigation in an embedded preview; the session is
    // still established and the report cards remain available.
  }
}

function renderLoggedOut(): void {
  setHidden(query("[data-login-panel]"), false);
  setHidden(query("[data-session-panel]"), true);
}

function renderLoggedIn(session: IncomeSession): void {
  setHidden(query("[data-login-panel]"), true);
  setHidden(query("[data-session-panel]"), false);
  const name = query<HTMLElement>("[data-session-name]");
  if (name !== null) name.textContent = session.user.name;

  const mustChange = session.user.mustChangePassword;
  setHidden(query("[data-must-change-notice]"), !mustChange);
  setHidden(query("[data-initial-notice]"), mustChange || !session.user.usesInitialPassword);
  setHidden(query("[data-change-password]"), !mustChange);
  setHidden(query("[data-authenticated-reports-area]"), mustChange);
}

function bindForgotForm(): void {
  const form = query<HTMLFormElement>("[data-forgot-form]");
  const status = query("[data-forgot-status]");
  const cooldown = query<HTMLElement>("[data-forgot-cooldown]");
  const suffixField = query<HTMLElement>("[data-employee-suffix-field]");
  if (form === null) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  let cooldownUntil = 0;
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  const renderCooldown = (): void => {
    const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1_000));
    if (cooldown !== null) cooldown.textContent = recoveryCooldownText(remaining);
    if (submit !== null) submit.disabled = remaining > 0;
    if (remaining === 0 && cooldownTimer !== null) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  };

  const startCooldown = (seconds: number): void => {
    const safeSeconds = Math.min(3_600, Math.max(1, Math.ceil(seconds)));
    cooldownUntil = Math.max(cooldownUntil, Date.now() + safeSeconds * 1_000);
    renderCooldown();
    if (cooldownTimer === null) cooldownTimer = setInterval(renderCooldown, 1_000);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (Date.now() < cooldownUntil) {
      renderCooldown();
      return;
    }
    const name = formValue(form, "name").trim();
    const suffix = formValue(form, "employeeSuffix").trim();
    if (name.length === 0) {
      setStatus(status, "请输入姓名", "error");
      return;
    }
    if (suffixField instanceof HTMLElement && !suffixField.hidden && !/^\d{4}$/u.test(suffix)) {
      setStatus(status, "请输入 4 位工号后四位", "error");
      return;
    }
    setStatus(status, "正在发送重置信息……");
    if (submit !== null) submit.disabled = true;
    try {
      const payload = await apiRequest<unknown>(`${INCOME_ROOT}api/password/forgot`, {
        method: "POST",
        body: JSON.stringify({
          name,
          ...(suffix.length > 0 ? { employeeSuffix: suffix } : {}),
        }),
      });
      if (isRecord(payload) && payload.status === "needs_employee_suffix") {
        if (suffixField instanceof HTMLElement) suffixField.hidden = false;
        const suffixInput = form.elements.namedItem("employeeSuffix");
        if (suffixInput instanceof HTMLInputElement) suffixInput.required = true;
        setStatus(status, "发现同名成员，请填写工号后四位。", "success");
        return;
      }
      if (isRecord(payload) && payload.status === "sent") {
        startCooldown(RECOVERY_COOLDOWN_SECONDS);
        setStatus(status, typeof payload.message === "string"
          ? payload.message
          : "重置信息已发送，请前往您的邮箱查看。", "success");
        form.reset();
        if (suffixField instanceof HTMLElement) suffixField.hidden = true;
        return;
      }
      setStatus(status, "无法发送重置信息，请稍后再试。", "error");
    } catch (error) {
      if (error instanceof IncomeApiError && error.retryAfterSeconds !== null) {
        startCooldown(error.retryAfterSeconds);
      }
      const message = error instanceof IncomeApiError && error.retryAfterSeconds !== null
        ? `${error.message}（请在 ${error.retryAfterSeconds} 秒后重试）`
        : error instanceof Error
          ? error.message
          : "无法发送重置信息，请稍后再试。";
      setStatus(status, message, "error");
    } finally {
      if (submit !== null) submit.disabled = Date.now() < cooldownUntil;
    }
  });
}

function bindChangePasswordForm(onSuccess: (session: IncomeSession) => void): void {
  const form = query<HTMLFormElement>("[data-change-form]");
  const status = query("[data-change-status]");
  if (form === null) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = formValue(form, "currentPassword");
    const newPassword = formValue(form, "newPassword");
    const confirmPassword = formValue(form, "confirmPassword");
    if (newPassword !== confirmPassword) {
      setStatus(status, "两次输入的新密码不一致。", "error");
      return;
    }
    setStatus(status, "正在保存新密码……");
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit !== null) submit.disabled = true;
    try {
      const next = await apiRequest<IncomeSession>(`${INCOME_ROOT}api/password/change`, {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      form.reset();
      setStatus(status, "密码已更新。", "success");
      onSuccess(next);
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : "密码修改失败，请稍后再试。", "error");
    } finally {
      if (submit !== null) submit.disabled = false;
    }
  });
}

function bindLoginForm(): void {
  const form = query<HTMLFormElement>("[data-login-form]");
  const status = query("[data-login-status]");
  if (form === null) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = formValue(form, "phone").trim();
    const password = formValue(form, "password");
    if (phone.length === 0 || password.length === 0) {
      setStatus(status, "请输入手机号和密码。", "error");
      return;
    }
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    setStatus(status, "正在验证登录信息……");
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit !== null) submit.disabled = true;
    try {
      const session = await apiRequest<IncomeSession>(`${INCOME_ROOT}api/session`, {
        method: "POST",
        body: JSON.stringify({ phone, password, next }),
      });
      form.reset();
      renderLoggedIn(session);
      setStatus(status, session.user.mustChangePassword
        ? "登录成功，请先完成密码修改。"
        : "登录成功，正在打开报告归档。", "success");
      if (!session.user.mustChangePassword) {
        try {
          const reports = await loadReports();
          renderReports(reports);
          setHidden(query("[data-authenticated-reports-area]"), false);
        } catch (error) {
          setStatus(query("[data-reports-status]"), error instanceof Error ? error.message : "报告暂时无法加载。", "error");
        }
      }
      navigateAfterLogin(session.next);
    } catch (error) {
      const message = error instanceof IncomeApiError && error.retryAfterSeconds !== null
        ? `${error.message}（请在 ${error.retryAfterSeconds} 秒后重试）`
        : error instanceof Error
          ? error.message
          : "登录失败，请稍后再试。";
      setStatus(status, message, "error");
    } finally {
      if (submit !== null) submit.disabled = false;
    }
  });
}

function bindSessionActions(): void {
  query<HTMLButtonElement>("[data-change-open]")?.addEventListener("click", () => {
    setHidden(query("[data-change-password]"), false);
    query<HTMLInputElement>('[data-change-form] input[name="currentPassword"]')?.focus();
  });
  query<HTMLButtonElement>("[data-forgot-toggle]")?.addEventListener("click", () => {
    setHidden(query("[data-forgot-panel]"), false);
    query<HTMLInputElement>('[data-forgot-form] input[name="name"]')?.focus();
  });
  query<HTMLButtonElement>("[data-forgot-close]")?.addEventListener("click", () => {
    setHidden(query("[data-forgot-panel]"), true);
    setStatus(query("[data-forgot-status]"), "");
  });
  query<HTMLButtonElement>("[data-change-close]")?.addEventListener("click", () => {
    const sessionPanel = query("[data-session-panel]");
    const mustChange = sessionPanel?.querySelector("[data-must-change-notice]") instanceof HTMLElement &&
      !(sessionPanel.querySelector("[data-must-change-notice]") as HTMLElement).hidden;
    if (!mustChange) setHidden(query("[data-change-password]"), true);
  });
  query<HTMLButtonElement>("[data-logout]")?.addEventListener("click", async () => {
    const button = query<HTMLButtonElement>("[data-logout]");
    if (button !== null) button.disabled = true;
    try {
      await apiRequest(`${INCOME_ROOT}api/session`, { method: "DELETE" });
      window.location.assign(INCOME_ROOT);
    } catch (error) {
      setStatus(query("[data-reports-status]"), error instanceof Error ? error.message : "退出登录失败。", "error");
      if (button !== null) button.disabled = false;
    }
  });
}

export async function bootstrapIncomeForecast(): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  bindLoginForm();
  bindForgotForm();
  bindReportPicker();
  bindSessionActions();
  bindChangePasswordForm((next) => {
    renderLoggedIn(next);
    void loadReports().then(renderReports).catch((error: unknown) => {
      setStatus(query("[data-reports-status]"), error instanceof Error ? error.message : "报告暂时无法加载。", "error");
    });
  });

  try {
    const session = await apiRequest<IncomeSession>(`${INCOME_ROOT}api/session`);
    renderLoggedIn(session);
    if (!session.user.mustChangePassword) {
      try {
        renderReports(await loadReports());
      } catch (error) {
        setStatus(query("[data-reports-status]"), error instanceof Error ? error.message : "报告暂时无法加载。", "error");
      }
    }
  } catch {
    renderLoggedOut();
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void bootstrapIncomeForecast(), { once: true });
  } else {
    void bootstrapIncomeForecast();
  }
}
