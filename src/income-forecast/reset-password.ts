import "./styles.css";
import {
  apiRequest,
  INCOME_ROOT,
  type IncomeSession,
} from "./income-api";

export type RecoveryParams = Readonly<{
  tokenHash: string | null;
  valid: boolean;
}>;

export function extractRecoveryParams(search: string): RecoveryParams {
  try {
    const params = new URLSearchParams(search);
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    if (
      tokenHash === null ||
      tokenHash.length < 32 ||
      tokenHash.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/u.test(tokenHash) ||
      type !== "recovery"
    ) {
      return { tokenHash: null, valid: false };
    }
    return { tokenHash, valid: true };
  } catch {
    return { tokenHash: null, valid: false };
  }
}

export function clearRecoveryUrl(): void {
  if (typeof window === "undefined") return;
  try {
    window.history.replaceState(
      {},
      document.title,
      recoveryUrlWithoutToken(window.location.pathname, window.location.hash),
    );
  } catch {
    // History is unavailable in some embedded previews; do not expose the token in UI.
  }
}

export function recoveryUrlWithoutToken(pathname: string, hash = ""): string {
  return `${pathname}${hash}`;
}

function setStatus(element: HTMLElement | null, message: string, tone?: "error" | "success"): void {
  if (element === null) return;
  element.textContent = message;
  if (tone === undefined) element.removeAttribute("data-tone");
  else element.dataset.tone = tone;
}

function value(form: HTMLFormElement, name: string): string {
  const item = new FormData(form).get(name);
  return typeof item === "string" ? item : "";
}

export async function submitPasswordReset(
  tokenHash: string,
  password: string,
): Promise<IncomeSession | null> {
  const response = await apiRequest<unknown>(`${INCOME_ROOT}api/password/reset`, {
    method: "POST",
    body: JSON.stringify({ tokenHash, password }),
  });
  return response !== null && typeof response === "object" ? response as IncomeSession : null;
}

export function bootstrapPasswordReset(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const form = document.querySelector<HTMLFormElement>("[data-reset-form]");
  const status = document.querySelector<HTMLElement>("[data-reset-status]");
  const invalid = document.querySelector<HTMLElement>("[data-reset-invalid]");
  if (form === null || status === null || invalid === null) return;

  const params = extractRecoveryParams(window.location.search);
  if (!params.valid || params.tokenHash === null) {
    form.hidden = true;
    invalid.hidden = false;
    setStatus(invalid, "重置链接无效或已过期，请返回入口重新申请。", "error");
    return;
  }
  const tokenHash = params.tokenHash;
  // Remove the one-time token from browser history immediately. The local
  // variable above is the only copy retained for the POST that follows.
  clearRecoveryUrl();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = value(form, "password");
    const confirmPassword = value(form, "confirmPassword");
    if (password !== confirmPassword) {
      setStatus(status, "两次输入的新密码不一致。", "error");
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit !== null) submit.disabled = true;
    setStatus(status, "正在保存新密码……");
    try {
      await submitPasswordReset(tokenHash, password);
      clearRecoveryUrl();
      form.hidden = true;
      setStatus(status, "密码已重置，请使用新密码登录。", "success");
      window.setTimeout(() => {
        try {
          window.location.assign(INCOME_ROOT);
        } catch {
          // The success state remains visible if navigation is blocked in preview.
        }
      }, 900);
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : "密码重置失败，请重新申请。", "error");
    } finally {
      if (submit !== null) submit.disabled = false;
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapPasswordReset, { once: true });
  } else {
    bootstrapPasswordReset();
  }
}
