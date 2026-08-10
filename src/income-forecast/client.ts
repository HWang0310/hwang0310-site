import "./styles.css";

const INCOME_ROOT = "/projects/income-forecast/";
const REPORT_ROOT = `${INCOME_ROOT}reports/`;

export type IncomeSession = Readonly<{
  user: Readonly<{
    id: string;
    name: string;
    role: "user" | "admin" | "root_admin";
    usesInitialPassword: boolean;
    mustChangePassword: boolean;
  }>;
  next: string;
}>;

export type IncomeReport = Readonly<{
  date: string;
  webPath: string;
  visibility: "public" | "private";
  pinned: boolean;
  sizeBytes: number;
  online: boolean;
}>;

type ApiErrorPayload = Readonly<{
  error?: unknown;
  status?: unknown;
  message?: unknown;
  retryAfterSeconds?: unknown;
}>;

export class IncomeApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "IncomeApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function payloadMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  return typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
      ? payload.message
      : fallback;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const retryAfter =
      isRecord(payload) && Number.isInteger(payload.retryAfterSeconds)
        ? Number(payload.retryAfterSeconds)
        : null;
    throw new IncomeApiError(
      response.status,
      payloadMessage(payload, "服务暂不可用，请稍后再试"),
      retryAfter,
    );
  }
  return payload as T;
}

function query<T extends Element>(selector: string): T | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<T>(selector);
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

function createReportCard(report: IncomeReport, index: number): HTMLAnchorElement {
  const card = document.createElement("a");
  card.className = "if-report-card";
  card.href = report.webPath;

  const number = document.createElement("span");
  number.className = "if-report-index";
  number.textContent = String(index + 1).padStart(2, "0");

  const body = document.createElement("span");
  body.className = "if-report-card-body";
  const title = document.createElement("strong");
  title.textContent = formatReportDate(report.date);
  const description = document.createElement("small");
  description.textContent = report.visibility === "private"
    ? `权限报告 · ${formatSize(report.sizeBytes)}`
    : "全省及 17 个地市 · 公开示例";
  body.appendChild(title);
  body.appendChild(description);

  const arrow = document.createElement("span");
  arrow.className = "if-report-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  card.appendChild(number);
  card.appendChild(body);
  card.appendChild(arrow);
  return card;
}

function renderReports(reports: readonly IncomeReport[]): void {
  const container = query<HTMLElement>("[data-authenticated-reports]");
  const count = query<HTMLElement>("[data-report-count]");
  if (container === null) return;
  container.replaceChildren();
  const sorted = [...reports].sort((left, right) => left.date.localeCompare(right.date));
  sorted.forEach((report, index) => container.appendChild(createReportCard(report, index)));
  if (count !== null) count.textContent = `${sorted.length} 期在线报告`;
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
  const suffixField = query<HTMLElement>("[data-employee-suffix-field]");
  if (form === null) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
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
        setStatus(status, typeof payload.message === "string"
          ? payload.message
          : "重置信息已发送，请前往您的邮箱查看。", "success");
        form.reset();
        if (suffixField instanceof HTMLElement) suffixField.hidden = true;
        return;
      }
      setStatus(status, "无法发送重置信息，请稍后再试。", "error");
    } catch (error) {
      const message = error instanceof IncomeApiError && error.retryAfterSeconds !== null
        ? `${error.message}（请在 ${error.retryAfterSeconds} 秒后重试）`
        : error instanceof Error
          ? error.message
          : "无法发送重置信息，请稍后再试。";
      setStatus(status, message, "error");
    } finally {
      if (submit !== null) submit.disabled = false;
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
