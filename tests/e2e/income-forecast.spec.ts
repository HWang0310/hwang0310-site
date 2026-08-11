import { expect, test, type Page, type Route } from "@playwright/test";

const ROOT = "/projects/income-forecast/";
const PUBLIC_REPORTS = [
  "/projects/income-forecast/reports/2026/07/20/",
  "/projects/income-forecast/reports/2026/07/25/",
] as const;
const PRIVATE_REPORTS = [
  "/projects/income-forecast/reports/2026/07/24/",
  "/projects/income-forecast/reports/2026/07/26/",
] as const;

type SessionPayload = Readonly<{
  user: Readonly<{
    id: string;
    name: string;
    role: "user" | "admin" | "root_admin";
    usesInitialPassword: boolean;
    mustChangePassword: boolean;
  }>;
  next: string;
}>;

type ReportPayload = Readonly<{
  date: string;
  webPath: string;
  visibility: "public" | "private";
  pinned: boolean;
  sizeBytes: number;
  online: boolean;
}>;

const REPORTS: ReportPayload[] = [
  ...PUBLIC_REPORTS.map((webPath, index) => ({
    date: index === 0 ? "20260720" : "20260725",
    webPath,
    visibility: "public" as const,
    pinned: true,
    sizeBytes: 0,
    online: true,
  })),
  {
    date: "20260724",
    webPath: PRIVATE_REPORTS[0],
    visibility: "private",
    pinned: false,
    sizeBytes: 2_100_000,
    online: true,
  },
  {
    date: "20260726",
    webPath: PRIVATE_REPORTS[1],
    visibility: "private",
    pinned: false,
    sizeBytes: 1_100_000,
    online: true,
  },
  {
    date: "20260802",
    webPath: "/projects/income-forecast/reports/2026/08/02/",
    visibility: "private",
    pinned: false,
    sizeBytes: 1_200_000,
    online: true,
  },
];

async function fulfillJson(route: Route, status: number, payload: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(payload),
  });
}

async function stubAnonymousSession(page: Page): Promise<void> {
  await page.route("**/projects/income-forecast/api/session", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 401, { error: "未登录" });
      return;
    }
    await fulfillJson(route, 401, { error: "登录失败" });
  });
}

async function stubReports(page: Page): Promise<void> {
  await page.route("**/projects/income-forecast/api/reports", async (route) => {
    await fulfillJson(route, 200, { reports: REPORTS });
  });
}

test("anonymous entry exposes exactly the two public examples and locks private paths", async ({
  page,
}) => {
  await stubAnonymousSession(page);
  await page.goto(ROOT);

  const cards = page.locator("[data-public-reports] .if-report-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("2026 年 7 月 20 日");
  await expect(cards.nth(1)).toContainText("2026 年 7 月 25 日");
  await expect(page.locator("[data-public-reports]")).not.toContainText("2026 年 7 月 24 日");
  await expect(page.locator("[data-public-reports]")).not.toContainText("2026 年 7 月 26 日");

  for (const path of PUBLIC_REPORTS) {
    const response = await page.request.get(path);
    expect(response.status(), `${path} remains a public example`).toBe(200);
  }
  for (const path of PRIVATE_REPORTS) {
    const response = await page.request.get(path);
    expect([404, 302, 401, 403, 503], `${path} must not be public`).toContain(response.status());
    const body = await response.text();
    expect(body).not.toMatch(/收入预估报告-202607(?:24|26)/u);
  }
});

test("a logged-in user follows the safe next path after login", async ({ page }) => {
  const next = PRIVATE_REPORTS[0];
  await page.route("**/projects/income-forecast/api/session", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 401, { error: "未登录" });
      return;
    }
    await fulfillJson(route, 200, {
      user: {
        id: "user-demo",
        name: "测试成员",
        role: "user",
        usesInitialPassword: false,
        mustChangePassword: false,
      },
      next,
    } satisfies SessionPayload);
  });
  await stubReports(page);
  await page.route(/\/projects\/income-forecast\/reports\/2026\/07\/24(?:\/.*)?$/u, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>私有报告</title><main>20260724</main>",
    });
  });

  await page.goto(`${ROOT}?next=${encodeURIComponent(next)}`);
  await page.locator('[data-login-form] input[name="phone"]').fill("13800000000");
  await page.locator('[data-login-form] input[name="password"]').fill("password");
  await page.locator('[data-login-form]').getByRole("button", { name: /登录报告中心/ }).click();
  await expect(page).toHaveURL(/\/projects\/income-forecast\/reports\/2026\/07\/24\/$/u);
});

test("initial password is a visible non-blocking notice", async ({ page }) => {
  await page.route("**/projects/income-forecast/api/session", async (route) => {
    await fulfillJson(route, 200, {
      user: {
        id: "user-initial",
        name: "初始密码成员",
        role: "user",
        usesInitialPassword: true,
        mustChangePassword: false,
      },
      next: ROOT,
    } satisfies SessionPayload);
  });
  await stubReports(page);
  await page.goto(ROOT);

  await expect(page.locator("[data-initial-notice]")).toBeVisible();
  await expect(page.locator("[data-authenticated-reports-area]")).toBeVisible();
  await expect(page.locator("[data-must-change-notice]")).toBeHidden();
});

test("the authenticated archive cascades year month and day before explicit navigation", async ({ page }) => {
  await page.route("**/projects/income-forecast/api/session", async (route) => {
    await fulfillJson(route, 200, {
      user: {
        id: "user-picker",
        name: "日期选择成员",
        role: "user",
        usesInitialPassword: false,
        mustChangePassword: false,
      },
      next: ROOT,
    } satisfies SessionPayload);
  });
  await stubReports(page);
  await page.route(/\/projects\/income-forecast\/reports\/2026\/07\/26\/?$/u, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>私有报告</title><main>20260726</main>",
    });
  });

  await page.goto(ROOT);
  await expect(page.locator("[data-report-year]")).toHaveValue("2026");
  await expect(page.locator("[data-report-month]")).toHaveValue("08");
  await expect(page.locator("[data-report-day]")).toHaveValue("02");
  await expect(page.locator("[data-report-selection]")).toContainText("2026年8月2日");

  await page.locator("[data-report-month]").selectOption("07");
  await expect(page.locator("[data-report-day]")).toHaveValue("26");
  await expect(page).toHaveURL(/\/projects\/income-forecast\/$/u);

  await page.locator("[data-report-open]").click();
  await expect(page).toHaveURL(/\/projects\/income-forecast\/reports\/2026\/07\/26\/$/u);
});

test("must-change sessions block the private archive", async ({ page }) => {
  await page.route("**/projects/income-forecast/api/session", async (route) => {
    await fulfillJson(route, 200, {
      user: {
        id: "user-must-change",
        name: "待改密成员",
        role: "user",
        usesInitialPassword: true,
        mustChangePassword: true,
      },
      next: ROOT,
    } satisfies SessionPayload);
  });
  await page.goto(ROOT);

  await expect(page.locator("[data-must-change-notice]")).toBeVisible();
  await expect(page.locator("[data-change-password]")).toBeVisible();
  await expect(page.locator("[data-authenticated-reports-area]")).toBeHidden();
});

test("ordinary users see no administrator data", async ({ page }) => {
  await page.route(/\/projects\/income-forecast\/api\/admin\/(?:users|reports|audit)(?:$|\?)/u, async (route) => {
    await fulfillJson(route, 403, { error: "需要管理员权限" });
  });
  await page.goto(`${ROOT}admin/`);

  await expect(page.locator("[data-admin-status]")).toHaveText("访问受限");
  await expect(page.locator("[data-admin-error]")).toHaveText("当前账号没有管理员权限。");
  await expect(page.locator("[data-admin-users-body]")).toContainText("正在加载成员");
});

test("administrator view shows live capacity and keeps dangerous controls explicit", async ({ page }) => {
  await page.route(/\/projects\/income-forecast\/api\/admin\/users(?:$|\?)/u, async (route) => {
    await fulfillJson(route, 200, {
      users: [{
        id: "admin-demo",
        fullName: "王昊",
        employeeNo: "ROOT",
        phone: "13800000000",
        email: "h***@example.com",
        role: "root_admin",
        active: true,
        usesInitialPassword: false,
        mustChangePassword: false,
      }],
    });
  });
  await page.route(/\/projects\/income-forecast\/api\/admin\/reports(?:$|\?)/u, async (route) => {
    await fulfillJson(route, 200, {
      reports: [],
      privateUsedBytes: 1.1 * 1024 * 1024,
      onlineTotalBytes: 2.1 * 1024 * 1024,
      softLimitBytes: 850 * 1024 * 1024,
      freeTierReferenceBytes: 1_000_000_000,
      nextEvictionDate: "20260724",
      lastCleanup: null,
    });
  });
  await page.route(/\/projects\/income-forecast\/api\/admin\/audit(?:$|\?)/u, async (route) => {
    await fulfillJson(route, 200, { events: [], page: 1, pageSize: 50, total: 0, nextPage: null });
  });
  await page.goto(`${ROOT}admin/`);

  await expect(page.locator("[data-capacity-private]")).toHaveText("1.1 MiB");
  await expect(page.locator("[data-capacity-total]")).toHaveText("2.1 MiB");
  await expect(page.locator("[data-capacity-next]")).toHaveText("2026.07.24");
  await expect(page.locator('[data-danger-action="true"]')).toHaveCount(2);
  await expect(page.locator("input[type=password]")).toHaveCount(0);
});

test("forgot-password feedback names the masked mailbox without exposing extra identity", async ({ page }) => {
  await stubAnonymousSession(page);
  await page.route("**/projects/income-forecast/api/password/forgot", async (route) => {
    await fulfillJson(route, 200, {
      status: "sent",
      message: "重置信息已发送。请前往您的邮箱：w***@example.com 查收。",
    });
  });
  await page.goto(ROOT);
  await page.getByRole("button", { name: "忘记密码？" }).click();
  await expect(page.locator("[data-forgot-cooldown]")).toHaveText(
    "每次发送后需等待60秒才能再次申请，请留意收件箱及垃圾邮件。",
  );
  await page.locator('[data-forgot-form] input[name="name"]').fill("王昊");
  const submit = page.locator('[data-forgot-form]').getByRole("button", { name: /发送重置信息/ });
  await submit.click();

  await expect(page.locator("[data-forgot-status]")).toContainText("请前往您的邮箱：w***@example.com");
  await expect(page.locator("[data-forgot-status]")).not.toContainText("13800000000");
  await expect(submit).toBeDisabled();
  await expect(page.locator("[data-forgot-cooldown]")).toHaveText(
    "请等待60秒后再次申请。请留意收件箱及垃圾邮件。",
  );
});

test("the income entry has no horizontal overflow at 360px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Run one deterministic 360px layout probe");
  await stubAnonymousSession(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(ROOT);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
