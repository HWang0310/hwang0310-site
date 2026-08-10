const INCOME_ROOT = "/projects/income-forecast/";

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

/** Same-origin JSON helper shared by the entry and reset pages. */
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

export { INCOME_ROOT };
