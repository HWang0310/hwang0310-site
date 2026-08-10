const INCOME_FORECAST_ROOT = "/projects/income-forecast/";
const MAX_NAME_LENGTH = 80;
const SAFE_HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(JSON.stringify(data), { ...init, headers });
}

export function requireSameOrigin(request: Request, siteOrigin: string): void {
  if (SAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  try {
    new URL(siteOrigin);
  } catch {
    throw new HttpError(500, "服务器配置不可用");
  }

  const origin = request.headers.get("Origin");
  if (origin === null || origin !== new URL(request.url).origin) {
    throw new HttpError(403, "请求来源无效");
  }
}

export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return INCOME_FORECAST_ROOT;
  }

  try {
    const url = new URL(value, "https://income-forecast.invalid");
    let decodedPath = url.pathname;
    for (let pass = 0; pass < 2; pass += 1) {
      const decoded = decodeURIComponent(decodedPath);
      if (decoded === decodedPath) break;
      decodedPath = decoded;
    }
    const normalizedDecodedPath = new URL(
      decodedPath,
      "https://income-forecast.invalid",
    ).pathname;
    if (
      url.origin !== "https://income-forecast.invalid" ||
      /[\\\u0000-\u001f\u007f]/u.test(decodedPath) ||
      (normalizedDecodedPath !== INCOME_FORECAST_ROOT.slice(0, -1) &&
        !normalizedDecodedPath.startsWith(INCOME_FORECAST_ROOT))
    ) {
      return INCOME_FORECAST_ROOT;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return INCOME_FORECAST_ROOT;
  }
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new HttpError(400, "请输入有效的手机号");
  }

  const phone = value.replace(/[\s-]/gu, "");
  if (!/^1[0-9]{10}$/u.test(phone)) {
    throw new HttpError(400, "请输入有效的手机号");
  }
  return phone;
}

export function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "请输入姓名");
  }

  const name = value.trim().replace(/\s+/gu, " ").normalize("NFC");
  if (
    name.length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new HttpError(400, "请输入有效的姓名");
  }
  return name;
}

export function maskEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "邮箱格式无效");
  }

  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) {
    throw new HttpError(400, "邮箱格式无效");
  }

  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const visibleStart = local.slice(0, Math.min(3, Math.max(1, local.length - 2)));
  const visibleEnd = local.length > 3 ? local.slice(-2) : "";
  return `${visibleStart}***${visibleEnd}@${domain}`;
}
