import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "https://hwang0310.dpdns.org";
const PUBLIC_REPORT_DATES = Object.freeze(["20260720", "20260725"]);
const PRIVATE_REPORT_DATES = Object.freeze(["20260724", "20260726"]);

function reportPath(date) {
  return `/projects/income-forecast/reports/${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}/`;
}

const PUBLIC_PATHS = Object.freeze([
  "/",
  "/projects/income-forecast/",
  ...PUBLIC_REPORT_DATES.map(reportPath),
]);
const PRIVATE_PATHS = Object.freeze(
  PRIVATE_REPORT_DATES.flatMap((date) => {
    const path = reportPath(date);
    return [path, `${path}assets/report.css`, `${path}assets/archive-manifest.js`];
  }),
);

function normalizeOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("origin must use HTTPS");
  }
  return parsed.origin;
}

function parseArgs(argv) {
  let origin = process.env.INCOME_FORECAST_ORIGIN ?? DEFAULT_ORIGIN;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--origin") {
      const value = argv[index + 1];
      if (!value) throw new Error("--origin requires a URL");
      origin = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true, origin };
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { help: false, origin: normalizeOrigin(origin) };
}

function safeStatus(status) {
  return Number.isInteger(status) ? String(status) : "ERR";
}

async function requestStatus(fetchImpl, origin, path, init = {}) {
  try {
    const response = await fetchImpl(new URL(path, origin), {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

/**
 * Probes only status codes. It deliberately does not read response bodies or
 * print request headers, cookies, credentials, or API payloads.
 *
 * @param {{ origin?: string, fetchImpl?: typeof fetch, logger?: (line: string) => void }} [options]
 * @returns {Promise<{ok: boolean, checks: Array<{path: string, status: number | null, expected: string}>, loginStatus: number | null}>}
 */
export async function runProductionProbe(options = {}) {
  const origin = normalizeOrigin(options.origin ?? process.env.INCOME_FORECAST_ORIGIN ?? DEFAULT_ORIGIN);
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? ((line) => console.log(line));
  const checks = [];
  let ok = true;

  for (const path of PUBLIC_PATHS) {
    const status = await requestStatus(fetchImpl, origin, path);
    checks.push({ path, status, expected: "200" });
    logger(`匿名 ${path} -> ${safeStatus(status)}`);
    if (status !== 200) ok = false;
  }

  for (const path of PRIVATE_PATHS) {
    const status = await requestStatus(fetchImpl, origin, path);
    checks.push({ path, status, expected: "not-200" });
    logger(`匿名 ${path} -> ${safeStatus(status)}`);
    if (status === 200) ok = false;
  }

  let loginStatus = null;
  const phone = process.env.INCOME_FORECAST_TEST_PHONE;
  const password = process.env.INCOME_FORECAST_TEST_PASSWORD;
  if ((phone && !password) || (!phone && password)) {
    logger("测试登录配置不完整，已跳过");
    ok = false;
  } else if (phone && password) {
    loginStatus = await requestStatus(fetchImpl, origin, "/projects/income-forecast/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, password, next: "/projects/income-forecast/" }),
    });
    logger(`测试登录 -> ${safeStatus(loginStatus)}`);
    if (loginStatus !== 200) ok = false;
  }

  return { ok, checks, loginStatus };
}

export {
  DEFAULT_ORIGIN,
  PUBLIC_PATHS,
  PRIVATE_PATHS,
  PUBLIC_REPORT_DATES,
  PRIVATE_REPORT_DATES,
  normalizeOrigin,
  reportPath,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(
        "用法：node scripts/verify-income-forecast-production.mjs [--origin https://hwang0310.dpdns.org]\n",
      );
    } else {
      const result = await runProductionProbe({ origin: args.origin });
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "生产探测失败"}\n`);
    process.exitCode = 1;
  }
}
