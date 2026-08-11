# Income Password and Report Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复零成本邮箱映射架构下的当前密码校验，并把登录后的报告长列表替换为年、月、日三级联动选择器。

**Architecture:** 密码路由继续以已验证的 `SessionUser` / `ProfileRecord` 为信任边界，但所有 Supabase password grant 都改用服务端资料中的邮箱；手机号只作为用户界面标识。报告入口把 API 返回的在线报告转换为纯函数驱动的级联选择状态，DOM 层只负责填充三个选择器、摘要和安全报告链接。

**Tech Stack:** TypeScript、Cloudflare Pages Functions、Supabase Auth、Vite、Vitest、Playwright、CSS。

## Global Constraints

- 保持零短信成本，不启用 Supabase Phone provider。
- 浏览器不接收或显示人员邮箱，Supabase service role 不进入客户端或构建产物。
- 匿名仅能访问 `20260720` 和 `20260725`；私有报告权限不变。
- 修改密码不记录手机号、邮箱、当前密码或新密码。
- 完整报告默认选中最新在线日期，选择日期后必须点击按钮才导航。
- 桌面和平板横向排列，640px 以下纵向排列；控件最小高度 44px。
- 公开示例卡片与报告内部已有三级选择器保持不变。

---

### Task 1: Unify password reauthentication on the trusted email identity

**Files:**
- Modify: `functions/projects/income-forecast/api/password/change.ts`
- Modify: `functions/projects/income-forecast/api/password/reset.ts`
- Modify: `tests/function-password.test.ts`

**Interfaces:**
- Consumes: `SessionUser.email`, `ProfileRecord.email`, existing `PasswordAuthSession`.
- Produces: `ChangePasswordDependencies.signInWithPassword(email: string, password: string)` and `establishSession(email: string, password: string)`; `ResetPasswordDependencies.signInWithPassword(email: string, password: string)`.

- [ ] **Step 1: Write failing route tests for the trusted email identifier**

Update the change-password success test to record the first authentication argument and require the server-side profile email:

```ts
let reauthInput: { email: string; password: string } | null = null;
const setup = changeDependencies({
  signInWithPassword: async (email, password) => {
    reauthInput = { email, password };
    return authSession;
  },
});
expect(reauthInput).toEqual({ email: profile.email, password: "old-pass" });
```

Extend the same test to record `establishSession` and require `{ email: profile.email, password: "new-pass" }`. In the reset-password success test, require the post-reset sign-in argument to be `profile.email`.

- [ ] **Step 2: Run the password suite and verify RED**

Run:

```bash
npm test -- --run tests/function-password.test.ts
```

Expected: the new assertions fail because both routes still pass `profile.phone` / `session.phone`.

- [ ] **Step 3: Change the dependency contracts and production Supabase calls**

In both routes, rename the trusted identifier parameter from `phone` to `email` and call:

```ts
authClient.auth.signInWithPassword({ email, password })
```

In `postChangePassword`, pass `session.email` for current-password reauthentication and new-session establishment. In `postResetPassword`, pass the trusted `profile.email` when establishing the new session. Preserve all existing userId/role checks, revocation order, Cookie behavior, audit redaction and error mapping.

- [ ] **Step 4: Run targeted and adjacent authentication tests**

Run:

```bash
npm test -- --run tests/function-password.test.ts tests/function-session.test.ts tests/function-rate-limit.test.ts
npm run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the authentication fix**

```bash
git add functions/projects/income-forecast/api/password/change.ts functions/projects/income-forecast/api/password/reset.ts tests/function-password.test.ts
git commit -m "fix: reauthenticate password changes by email"
```

### Task 2: Replace the authenticated report grid with a cascading date picker

**Files:**
- Modify: `src/income-forecast/client.ts`
- Modify: `projects/income-forecast/index.html`
- Modify: `src/income-forecast/styles.css`
- Modify: `tests/income-ui.test.ts`
- Modify: `tests/e2e/income-forecast.spec.ts`

**Interfaces:**
- Consumes: `IncomeReport[]` returned by `/projects/income-forecast/api/reports` and validated by `safeReportFromUnknown`.
- Produces:

```ts
export type ReportPickerState = Readonly<{
  years: readonly string[];
  months: readonly string[];
  days: readonly string[];
  year: string;
  month: string;
  day: string;
  report: IncomeReport | null;
}>;

export function resolveReportPicker(
  reports: readonly IncomeReport[],
  requested?: Readonly<{ year?: string; month?: string; day?: string }>,
): ReportPickerState;
```

- [ ] **Step 1: Write failing unit tests for cascading selection**

Add hand-derived fixtures spanning multiple years and months. Require:

```ts
const latest = resolveReportPicker(reports);
expect(latest).toMatchObject({
  years: ["2027", "2026"],
  year: "2027",
  months: ["01"],
  month: "01",
  days: ["03"],
  day: "03",
});

const july2026 = resolveReportPicker(reports, { year: "2026", month: "07" });
expect(july2026.days).toEqual(["31", "25", "20"]);
expect(july2026.day).toBe("31");
expect(july2026.report?.date).toBe("20260731");
```

Also assert that an unavailable requested year/month/day falls back to the newest valid option in that scope and an empty array returns disabled empty state.

- [ ] **Step 2: Write failing HTML and browser behavior tests**

In `tests/income-ui.test.ts`, require the markers `data-report-year`, `data-report-month`, `data-report-day`, `data-report-open`, `data-report-selection`, and explicit labels.

In the logged-in Playwright flow, stub dates across two months, then require the default latest date, select an earlier month, verify its newest day, and confirm navigation only after clicking “打开报告”.

- [ ] **Step 3: Run the new UI tests and verify RED**

Run:

```bash
npm test -- --run tests/income-ui.test.ts
npx playwright test tests/e2e/income-forecast.spec.ts --project=desktop-chromium
```

Expected: unit import/marker assertions and selector locators fail because the picker does not exist.

- [ ] **Step 4: Implement the pure picker state**

In `client.ts`, validate date strings already accepted by `safeReportFromUnknown`, sort available values descending, and resolve the selection in this order: requested valid value, otherwise newest valid value. Derive the selected report by exact `YYYYMMDD` match. Do not derive navigation paths from select values; use only `report.webPath` already checked by `safeReportFromUnknown`.

- [ ] **Step 5: Implement the semantic picker markup and controller**

Replace the authenticated report grid with three labelled `<select>` elements, a selection summary, and an anchor/button styled as the primary action. Bind `change` handlers once; each handler calls `resolveReportPicker()` with the still-valid higher-level selection and re-renders options. For empty reports, disable all controls and report “暂无可用报告” in the existing live region.

- [ ] **Step 6: Add responsive and focus styles**

Use a grid/flex layout that keeps selectors and action aligned on wider screens and switches to one column at `max-width: 640px`. Apply `min-height: 44px`, existing color tokens, `:focus-visible`, disabled styles and `min-width: 0` to prevent overflow.

- [ ] **Step 7: Run targeted UI and E2E tests until GREEN**

Run:

```bash
npm test -- --run tests/income-ui.test.ts
npx playwright test tests/e2e/income-forecast.spec.ts --project=desktop-chromium
npm run typecheck
npm run build
```

Expected: unit tests, desktop E2E, typecheck and build all pass; `dist` still contains only the two public report dates.

- [ ] **Step 8: Commit the report picker**

```bash
git add src/income-forecast/client.ts projects/income-forecast/index.html src/income-forecast/styles.css tests/income-ui.test.ts tests/e2e/income-forecast.spec.ts
git commit -m "feat: add cascading report date picker"
```

### Task 3: Full verification, deployment and source synchronization

**Files:**
- Verify: all modified files and generated `dist/`
- Do not commit: `dist/`, credentials, cookies, roster source or test artifacts

**Interfaces:**
- Consumes: Task 1 email-based password routes and Task 2 report picker.
- Produces: deployed Cloudflare Pages version and matching public GitHub `main` source tree.

- [ ] **Step 1: Run the full local verification gate**

```bash
npm test -- --run
npm run typecheck
npm run build
npm run test:e2e
git diff --check
```

Expected: all suites pass; expected skips remain explicit; build stages only `20260720` and `20260725` as public reports.

- [ ] **Step 2: Deploy the complete site from the repository root**

Use the repository’s existing Cloudflare Pages workflow with project `hwang0310-site`. Confirm the deployment includes Functions and all six configured production secrets without printing secret values.

- [ ] **Step 3: Verify anonymous and authenticated production boundaries**

Run:

```bash
npm run verify:income
```

Expected: homepage, project entry and public dates return 200; private dates redirect while anonymous. Then use the existing authorized test account without printing credentials to confirm login 200, the picker lists all online authorized dates, a selected private report returns 200, admin access matches role, and logout succeeds.

- [ ] **Step 4: Verify the password-provider regression without changing the user’s password**

Confirm current-password authentication reaches Supabase through the email provider by checking the deployed route code hash and current Auth logs/test adapter contract. Do not temporarily change and restore a real user password as a production probe.

- [ ] **Step 5: Commit any verification-only contract updates and synchronize GitHub**

If verification adds no source change, do not create an empty commit. Push the final tree to public `HWang0310/hwang0310-site` `main`; verify the remote tree SHA matches local `HEAD^{tree}`. Never force-push unrelated history.

