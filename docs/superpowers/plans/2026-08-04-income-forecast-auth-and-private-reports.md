# 收入预估登录管理与私有报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为收入预估项目上线手机号登录、邮箱重置、管理员后台和 Supabase 私有报告，同时让 `income-forecast-2-0` 以后安全发布新日期且不覆盖个人主页。

**Architecture:** Cloudflare Pages 继续提供个人主页和 `20260720`、`20260725` 两期静态公开示例；Pages Functions 作为浏览器唯一访问的同源服务端，负责 Supabase Auth 会话、PostgreSQL 业务表、限流、管理 API 和私有 Storage 文件代理。报告 Skill 保留原自然语言调用契约，公开白名单走完整站点 Cloudflare 部署，其他日期只做 Supabase 版本化私有上传、容量清理和元数据激活。

**Tech Stack:** Node.js 22+、TypeScript 7、Vite 6、Vitest 4、Playwright 1.62、Cloudflare Pages Functions / Wrangler 4.118.0、Supabase CLI 2.111.0、Supabase PostgreSQL / Auth / Storage、`@supabase/supabase-js` 2.112.0、Python 3 标准库、ExcelJS 4.4.0。

## Global Constraints

- 浏览器只请求 `https://hwang0310.dpdns.org`，不直接请求 `supabase.co`、Google 或 Turnstile。
- 未登录只可访问 `20260720`、`20260725`；二者永久公开、置顶、不可清理。
- `20260724`、`20260726` 和未来新日期默认私有，认证或配置失败不得退回公开静态发布。
- 初始账号和密码均为人员清单中的手机号；首次登录不强制改密，只显示非阻断提示。
- 密码仅由 Supabase Auth 保存哈希；业务表、日志、GitHub、Skill 和部署包不保存明文或可逆密码。
- 王昊为 `root_admin`；授权只信任服务端 `app_metadata`，不能信任 `user_metadata`。
- 同手机号 5 分钟最多失败 10 次、同网络地址最多 20 次、王昊最多 3 次；下一次尝试触发暂停 5 分钟。
- 同一规范化姓名的忘记密码请求 60 秒最多 1 次、每小时最多 10 次；成功提示必须展示 `wan***ao@chinatelecom.cn` 形式的邮箱。
- 私有报告软上限固定为 850 MiB；只清理最早、私有、在线且未置顶的线上副本。
- Cloudflare 公共构建、GitHub 公共仓库和 Supabase Storage 中均不得出现人员清单源文件、Word、Excel、Python、测试产物、缓存或凭据。
- 163 SMTP 授权码、Supabase Service Role、Cloudflare 令牌只进入平台秘密配置或 macOS 钥匙串。
- 复用现有 Supabase 和 Cloudflare 免费项目，不创建第二个项目，不启用短信、IPv4 Add-on、PITR 或其他付费能力。
- Supabase `auth` 系统表通过 Auth API 管理，`storage` schema 视为只读，文件操作只走 Storage API。
- Supabase 新表显式设置 `GRANT` 和 RLS，不依赖平台的默认 Data API 暴露行为。
- Cloudflare Direct Upload 必须从网站仓库目录运行 Wrangler，使根目录 `functions/` 与 `dist/` 一起部署。
- 收入报告原有全省/17 地市、年/月/日选择、主题、图表和打印功能保持不变。
- Skill 先改主库 `/Users/hwang/.codex/skills/income-forecast-2-0`，验证后同步移植副本和 ZIP。

---

## File Structure

### 网站仓库 `/Users/hwang/Movies/Codex工作空间/hwang0310-site`

- `shared/income-forecast/contracts.ts`：浏览器、Functions 和测试共用的公开日期、容量、请求/响应类型。
- `functions/_lib/env.ts`：Cloudflare 环境变量类型和缺失配置的安全失败。
- `functions/_lib/http.ts`：JSON 响应、Cookie、同源校验、安全 `next`、输入规范化、邮箱脱敏。
- `functions/_lib/supabase.ts`：公开 Auth 客户端和 Service Role 服务端客户端工厂。
- `functions/_lib/session.ts`：访问/刷新 Cookie、可信用户校验、普通用户和管理员门禁。
- `functions/_lib/rate-limit.ts`：HMAC 限流键和 PostgreSQL 原子限流 RPC 适配。
- `functions/_lib/audit.ts`：统一审计写入，过滤令牌、密码和完整 Cookie。
- `functions/_lib/reports.ts`：报告日期/对象路径校验、公开白名单、Content-Type 和私有下载。
- `functions/projects/income-forecast/api/session.ts`：登录、当前会话、登出。
- `functions/projects/income-forecast/api/password/forgot.ts`：姓名匹配和重置邮件发送。
- `functions/projects/income-forecast/api/password/reset.ts`：`token_hash` 验证和新密码提交。
- `functions/projects/income-forecast/api/password/change.ts`：登录后的主动改密和强制改密解除。
- `functions/projects/income-forecast/api/reports.ts`：按身份返回公开或全部在线报告。
- `functions/projects/income-forecast/api/admin/users.ts`、`users/[id].ts`：人员列表和启停/重置/强制改密。
- `functions/projects/income-forecast/api/admin/reports.ts`、`reports/[date].ts`：容量、报告列表和置顶维护。
- `functions/projects/income-forecast/api/admin/audit.ts`：分页审计查询。
- `functions/projects/income-forecast/reports/[[path]].ts`：私有报告 Catch-all 网关。
- `projects/income-forecast/index.html`、`src/income-forecast/client.ts`、`src/income-forecast/styles.css`：项目入口、登录和报告归档。
- `projects/income-forecast/reset-password/index.html`、`src/income-forecast/reset-password.ts`：同域密码重置页。
- `projects/income-forecast/admin/index.html`、`src/income-forecast/admin.ts`：王昊日常管理后台。
- `public/_routes.json`：只让收入预估 API 和私有报告路径触发 Functions，排除两期公开示例。
- `supabase/migrations/*_income_forecast_access_control.sql`：由 Supabase CLI 创建的唯一同名迁移。
- `supabase/tests/income_forecast_access_control.sql`：表、RLS、公开报告保护触发器和 RPC 的 SQL 验收。
- `supabase/templates/recovery.html`：同域 `token_hash` 找回密码邮件模板。
- `scripts/provision-income-forecast.mjs`：幂等创建私有桶和固定报告元数据。
- `scripts/import-income-users.mjs`：读取原始 XLSX、校验、默认 Dry Run、显式 `--apply` 创建/同步用户。
- `scripts/verify-income-forecast-production.mjs`：不打印凭据的生产路由验收。
- `tests/income-policy.test.ts`、`function-*.test.ts`、`income-ui.test.ts`、`roster-import.test.ts`：单元与契约测试。
- `tests/e2e/income-forecast.spec.ts`：公开、私有、登录、管理员和移动端浏览器回归。
- `docs/runbooks/income-forecast-auth.md`：Supabase、SMTP、Cloudflare、DBeaver 和日常后台维护手册。

### Skill 主库 `/Users/hwang/.codex/skills/income-forecast-2-0`

- `scripts/publishing_policy.py`：双公开白名单、桶名、850 MiB 和 1 GB 操作硬边界。
- `scripts/credential_provider.py`：环境变量优先、macOS 钥匙串回退的凭据读取。
- `scripts/supabase_publish.py`：清单、版本化上传、校验、清理、恢复和最后激活。
- `scripts/run_pipeline.py`：根据日期路由到公共 Cloudflare 或私有 Supabase 发布。
- `scripts/build_deploy_bundle.py`：公共部署只复制两期白名单，不再复制所有历史报告。
- `scripts/publish_pages.py`：从网站仓库工作目录调用 Wrangler，确保 Functions 一起上传。
- `assets/site-template/assets/common.js`：私有报告继续兼容动态在线清单和离线本地清单。
- `tests/test_private_publish.py`、`test_pipeline.py`、`test_deploy_bundle.py`、`test_skill_contract.py`：安全发布回归。
- `SKILL.md`、`references/cloudflare-publishing.md`：新的日常调用和故障恢复说明。

---

### Task 1: 固定运行时、依赖和 Cloudflare 配置

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `.node-version`
- Create via Cloudflare command: `wrangler.toml`
- Test: `tests/runtime-contract.test.ts`

**Interfaces:**
- Produces: Node 22+ 构建入口、Wrangler Pages 配置、Functions TypeScript 类型和不提交秘密的本地约定。

- [ ] **Step 1: 写运行时契约失败测试**

```ts
it("pins the Pages and Supabase toolchain", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(pkg.dependencies["@supabase/supabase-js"]).toBe("2.112.0");
  expect(pkg.devDependencies.wrangler).toBe("4.118.0");
  expect(pkg.devDependencies.supabase).toBe("2.111.0");
  expect(pkg.devDependencies.exceljs).toBe("4.4.0");
  expect(pkg.devDependencies["@cloudflare/workers-types"]).toBe("5.20260804.1");
  expect(pkg.engines.node).toBe(">=22");
});
```

- [ ] **Step 2: 运行测试确认依赖契约失败**

Run: `npm test -- --run tests/runtime-contract.test.ts`

Expected: FAIL，指出依赖或 `engines.node` 尚不存在。

- [ ] **Step 3: 保证本地命令使用 Node 22+**

当前默认终端 Node 为 20，Wrangler 4.118.0 会拒绝运行。先安装并选择独立的 Homebrew `node@22`，不覆盖 `$HOME` 或 Codex 运行时：

```bash
/opt/homebrew/bin/brew install node@22
NODE22_PREFIX=$(/opt/homebrew/bin/brew --prefix node@22)
export PATH="$NODE22_PREFIX/bin:$PATH"
node --version
```

Expected: `v22.x.x`。把 `.node-version` 写为单行 `22`；后续所有 npm、npx、测试和部署命令都在这个 PATH 下运行。

- [ ] **Step 4: 安装固定版本并补齐脚本**

Run:

```bash
npm install --save-exact @supabase/supabase-js@2.112.0
npm install --save-dev --save-exact wrangler@4.118.0 supabase@2.111.0 exceljs@4.4.0 @cloudflare/workers-types@5.20260804.1
```

在 `package.json` 增加：

```json
{
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "dev:pages": "npm run build && wrangler pages dev dist",
    "verify:income": "node scripts/verify-income-forecast-production.mjs"
  }
}
```

- [ ] **Step 5: 从现有 Pages 项目下载而非手写配置**

Run:

```bash
npx wrangler pages download config hwang0310-site
npx wrangler pages deploy --help
npx supabase db --help
npx supabase migration --help
```

当前 Wrangler 命令会生成 `wrangler.toml`；检查项目名 `hwang0310-site`、生产环境和兼容日期与 Dashboard 一致。若命令生成 `.wrangler/` 或 `supabase/.temp/`，把它们加入 `.gitignore`，同时加入 `.dev.vars`、`.env*`，但保留后缀为 `.example` 的无秘密示例。

- [ ] **Step 6: 扩大类型检查范围并运行门禁**

`tsconfig.json` 的 `include` 必须包含：

```json
["src", "shared", "functions", "tests", "scripts", "vite.config.ts", "vitest.config.ts"]
```

并把 `compilerOptions.types` 设为 `["node", "@cloudflare/workers-types"]`，确保 `Fetcher`、`PagesFunction` 和 `ExecutionContext` 在类型检查中真实存在。

Run: `npm test -- --run tests/runtime-contract.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 7: 提交运行时基线**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .node-version wrangler.toml tests/runtime-contract.test.ts
git commit -m "chore: pin income access runtime"
```

---

### Task 2: 固化双公开白名单、静态构建边界和座右铭位置

**Files:**
- Create: `shared/income-forecast/contracts.ts`
- Modify: `data/report-archive.json`
- Modify: `scripts/stage-static-assets.mjs`
- Modify: `scripts/build-site.mjs`
- Modify: `index.html`
- Modify: `tests/static-staging.test.ts`
- Modify: `tests/site-build.test.ts`
- Modify: `tests/content-contract.test.ts`
- Create: `tests/income-policy.test.ts`

**Interfaces:**
- Produces: `PUBLIC_REPORT_DATES`、`PRIVATE_STORAGE_SOFT_LIMIT_BYTES`、`ReportSummary` 和只复制公共文件的构建结果。

- [ ] **Step 1: 写白名单和不公开私有目录的失败测试**

```ts
expect(PUBLIC_REPORT_DATES).toEqual(["20260720", "20260725"]);
expect(PRIVATE_STORAGE_SOFT_LIMIT_BYTES).toBe(850 * 1024 * 1024);
expect(stagedDates).toEqual(["20260720", "20260725"]);
expect(existsSync("dist/projects/income-forecast/reports/2026/07/24")).toBe(false);
expect(existsSync("dist/projects/income-forecast/reports/2026/07/26")).toBe(false);
```

在内容契约中增加：

```ts
const motto = document.querySelector("[data-motto]")!;
const contact = document.querySelector("#contact")!;
expect(motto.nextElementSibling).toBe(contact);
```

- [ ] **Step 2: 运行定向测试确认旧构建会复制所有报告且座右铭位置错误**

Run: `npm test -- --run tests/income-policy.test.ts tests/static-staging.test.ts tests/content-contract.test.ts`

Expected: FAIL，至少包含私有报告仍被复制和座右铭不在 Contact 前。

- [ ] **Step 3: 定义跨层公开契约**

`shared/income-forecast/contracts.ts` 至少导出：

```ts
export const PUBLIC_REPORT_DATES = ["20260720", "20260725"] as const;
export const PRIVATE_STORAGE_SOFT_LIMIT_BYTES = 850 * 1024 * 1024;
export const PRIVATE_STORAGE_HARD_LIMIT_BYTES = 1_000_000_000;
export type AppRole = "user" | "admin" | "root_admin";
export type ReportVisibility = "public" | "private";
export type ReportSummary = {
  date: string;
  webPath: string;
  visibility: ReportVisibility;
  pinned: boolean;
  sizeBytes: number;
  online: boolean;
};
```

- [ ] **Step 4: 让静态资产管线只读取并复制明确公开条目**

把 `data/report-archive.json` 的每条记录增加 `visibility` 和 `pinned`；`readArchive()` 拒绝未知状态，并只为 `visibility === "public"` 且日期在 `PUBLIC_REPORT_DATES` 中的记录读取源目录和写入静态 Manifest。白名单日期缺失、被设为私有或未置顶时构建失败；私有日期即使存在本地源，也不得出现在 `dist`。

- [ ] **Step 5: 移动座右铭 DOM，不改文字和图片**

从 About 后删除现有 `[data-motto]` 整块，并把同一块放到 `#contact` 的紧前方。不要重写座右铭、图片 URL、Alt、配色或 CSS 类。

- [ ] **Step 6: 运行静态边界与首页测试**

Run: `npm test -- --run tests/income-policy.test.ts tests/static-staging.test.ts tests/site-build.test.ts tests/content-contract.test.ts`

Expected: PASS；构建清单只包含 `20260720`、`20260725`。

- [ ] **Step 7: 提交公共/私有构建边界**

```bash
git add shared/income-forecast/contracts.ts data/report-archive.json scripts/stage-static-assets.mjs scripts/build-site.mjs index.html tests/income-policy.test.ts tests/static-staging.test.ts tests/site-build.test.ts tests/content-contract.test.ts
git commit -m "feat: keep private reports out of static builds"
```

---

### Task 3: 创建 Supabase PostgreSQL Schema、RLS 和原子 RPC

**Files:**
- Create via `supabase migration new`: `supabase/migrations/*_income_forecast_access_control.sql`
- Create: `supabase/tests/income_forecast_access_control.sql`
- Create: `tests/supabase-schema-contract.test.ts`

**Interfaces:**
- Produces: `profiles`、`reports`、`audit_events`、`rate_limits`；`check_rate_limit`、`record_rate_limit_failure`、`clear_rate_limit`、`finalize_report_publish` RPC。

- [ ] **Step 1: 恢复并验证现有项目连接**

Run:

```bash
npx supabase --version
npx supabase link --project-ref dcymydheijnbqciemlzn
npx supabase migration list --linked
```

如果仍出现 `Password authentication failed`，从 Supabase 官方 Dashboard 重置/确认数据库密码后重新 `link`；密码只在官方提示或系统钥匙串中输入，不写入仓库。

- [ ] **Step 2: 写 Schema 契约失败测试**

测试通过 glob 找到唯一 `*_income_forecast_access_control.sql`，并断言迁移包含：

```ts
for (const required of [
  "create table public.profiles",
  "create table public.reports",
  "create table public.audit_events",
  "create table public.rate_limits",
  "enable row level security",
  "record_rate_limit_failure",
  "finalize_report_publish",
  "2026-07-20",
  "2026-07-25",
  "revoke all",
]) expect(sql.toLowerCase()).toContain(required);
```

Run: `npm test -- --run tests/supabase-schema-contract.test.ts`

Expected: FAIL，因为迁移尚未创建。

- [ ] **Step 3: 用 CLI 创建迁移文件**

Run: `npx supabase migration new income_forecast_access_control`

只编辑命令输出的唯一 `supabase/migrations/*_income_forecast_access_control.sql`，不自行伪造时间戳文件名。

- [ ] **Step 4: 写最小且完整的数据库结构**

迁移应创建枚举和核心字段：

```sql
create type public.app_role as enum ('user', 'admin', 'root_admin');
create type public.report_visibility as enum ('public', 'private');
create type public.report_status as enum ('staging', 'online', 'offline');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  employee_no text not null unique,
  phone text not null unique check (phone ~ '^1[0-9]{10}$'),
  email text not null unique,
  role public.app_role not null default 'user',
  is_active boolean not null default true,
  uses_initial_password boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`reports` 使用 `report_date date primary key`、`release_id uuid`、`storage_prefix text`、`visibility`、`pinned`、`status`、`size_bytes bigint`、`file_count integer`、`published_at`、`cleaned_at`。为 `2026-07-20`、`2026-07-25` 创建触发器：插入/更新时强制 `public + pinned + online`，删除时报错。

- [ ] **Step 5: 写最小授权、RLS 和原子函数**

对四张表启用 RLS，撤销 `anon`、`authenticated` 的全部表权限，只向 `service_role` 显式授予所需权限。RPC 使用 `security invoker`，只向 `service_role` 授予执行权。`record_rate_limit_failure` 必须在一条事务语句内锁定限流键、增加计数并设置 `blocked_until`；`finalize_report_publish` 在一个事务内激活新报告、把清理日期标为离线并写审计。

- [ ] **Step 6: 写 pgTAP/SQL 验收**

`supabase/tests/income_forecast_access_control.sql` 在事务中验证表、RLS、权限、公共日期保护和限流第 10/11、20/21、3/4 次边界，最后 `rollback`，不留下测试数据。

- [ ] **Step 7: 验证迁移并提交**

Run:

```bash
npm test -- --run tests/supabase-schema-contract.test.ts
npx supabase db push --linked --dry-run
npx supabase db advisors --linked
```

Expected: 契约 PASS，Dry Run 只显示本次迁移，Advisors 无未处理的安全错误。

```bash
git add supabase tests/supabase-schema-contract.test.ts
git commit -m "feat: define income access database"
```

---

### Task 4: 建立 Functions 的安全基础库

**Files:**
- Create: `functions/_lib/env.ts`
- Create: `functions/_lib/http.ts`
- Create: `functions/_lib/supabase.ts`
- Create: `functions/_lib/session.ts`
- Create: `functions/_lib/audit.ts`
- Create: `tests/function-foundation.test.ts`

**Interfaces:**
- Produces:
  - `requireEnv(env: Env): RuntimeConfig`
  - `json(data, init?): Response`
  - `requireSameOrigin(request, siteOrigin): void`
  - `safeNext(value): string`
  - `normalizePhone(value): string`
  - `normalizeName(value): string`
  - `maskEmail(value): string`
  - `getSession(request, env): Promise<SessionUser | null>`
  - `requireUser(request, env): Promise<SessionUser>`
  - `requireAdmin(request, env): Promise<SessionUser>`

- [ ] **Step 1: 写纯函数和会话门禁失败测试**

```ts
expect(normalizePhone(" 138-0013-8000 ")).toBe("13800138000");
expect(() => normalizePhone("123")).toThrow(/手机号/);
expect(maskEmail("wanghao@chinatelecom.cn")).toBe("wan***ao@chinatelecom.cn");
expect(safeNext("https://evil.example/")).toBe("/projects/income-forecast/");
expect(safeNext("/projects/income-forecast/reports/2026/07/26/")).toBe("/projects/income-forecast/reports/2026/07/26/");
```

- [ ] **Step 2: 运行测试确认模块尚不存在**

Run: `npm test -- --run tests/function-foundation.test.ts`

Expected: FAIL with module-not-found。

- [ ] **Step 3: 实现环境、HTTP 和 Cookie 基础**

`Env` 只声明变量名，不含值：

```ts
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RATE_LIMIT_HMAC_SECRET: string;
  SITE_ORIGIN: string;
  SUPABASE_STORAGE_BUCKET: string;
  ASSETS: Fetcher;
};
```

Cookie 名固定为 `if_access`、`if_refresh`，属性固定为 `HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/`。所有 POST/PATCH/DELETE 在读取 Cookie 前校验 `Origin === new URL(request.url).origin`，因此生产自定义域名和 Cloudflare 预览域名都只接受各自同源请求；`SITE_ORIGIN` 只用于生产邮件链接和规范网址。

- [ ] **Step 4: 创建两个 Supabase 客户端和可信会话校验**

公开客户端只执行手机号密码登录、刷新和恢复邮件；Service Role 客户端只存在 Functions 内。`getSession()` 先验证 access token 用户，再在需要时用 refresh token 刷新；随后查询 `profiles` 的启用状态，并从 `app_metadata.role` 读取授权角色。停用用户、缺少 Profile 或角色不匹配均返回 401/403。

- [ ] **Step 5: 实现审计字段白名单**

`writeAudit()` 只允许 `action`、`actorUserId`、`targetType`、`targetId`、`result`、`requestId` 和经过清理的业务元数据；发现键名包含 `password`、`token`、`cookie`、`secret` 时拒绝写入。

- [ ] **Step 6: 运行基础测试和类型检查**

Run: `npm test -- --run tests/function-foundation.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 7: 提交 Functions 基础库**

```bash
git add functions/_lib shared tests/function-foundation.test.ts
git commit -m "feat: add secure pages function foundation"
```

---

### Task 5: 实现手机号登录、会话和精确限流

**Files:**
- Create: `functions/_lib/rate-limit.ts`
- Create: `functions/projects/income-forecast/api/session.ts`
- Create: `tests/function-rate-limit.test.ts`
- Create: `tests/function-session.test.ts`

**Interfaces:**
- Consumes: Task 3 的限流 RPC，Task 4 的 Cookie、同源和 Session 工具。
- Produces: `GET/POST/DELETE /projects/income-forecast/api/session`。

- [ ] **Step 1: 写 10/11、20/21、3/4 次边界失败测试**

使用内存 Fake RPC，分别提交普通手机号、同 IP 和 `root_admin` 手机号。测试必须证明第 10/20/3 次失败仍被记录，下一次在调用 Auth 前返回 429，暂停时间是触发时刻后 5 分钟；成功登录清除手机号和管理员专用计数，但不清除 IP 窗口。

- [ ] **Step 2: 运行测试确认限流和 Session Route 尚不存在**

Run: `npm test -- --run tests/function-rate-limit.test.ts tests/function-session.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 HMAC 限流键和规则选择**

```ts
export const LOGIN_LIMITS = {
  phone: { windowSeconds: 300, maxFailures: 10, blockSeconds: 300 },
  ip: { windowSeconds: 300, maxFailures: 20, blockSeconds: 300 },
  rootAdmin: { windowSeconds: 300, maxFailures: 3, blockSeconds: 300 },
} as const;
```

通过 Web Crypto HMAC-SHA-256 生成 `phone:`、`ip:`、`root:` 前缀的不可逆键；客户端 IP 只接受 Cloudflare 注入的 `CF-Connecting-IP`。

- [ ] **Step 4: 实现登录、当前会话和登出**

POST 接受 `{phone,password,next}`，先规范化手机号、查 Profile 角色并检查所有适用限制，再调用 Supabase `signInWithPassword({ phone, password })`。失败时原子记录计数并返回统一错误；成功时写 HttpOnly Cookie、清除手机号计数并返回：

```ts
type SessionResponse = {
  user: {
    id: string;
    name: string;
    role: AppRole;
    usesInitialPassword: boolean;
    mustChangePassword: boolean;
  };
  next: string;
};
```

GET 验证并返回当前用户；DELETE 撤销/登出会话并清空两个 Cookie。

- [ ] **Step 5: 运行 Auth 单元测试**

Run: `npm test -- --run tests/function-rate-limit.test.ts tests/function-session.test.ts && npm run typecheck`

Expected: PASS，测试断言任何响应和审计都不含密码。

- [ ] **Step 6: 提交登录会话**

```bash
git add functions/_lib/rate-limit.ts functions/projects/income-forecast/api/session.ts tests/function-rate-limit.test.ts tests/function-session.test.ts
git commit -m "feat: add phone sessions and login limits"
```

---

### Task 6: 实现主动改密、姓名找回和同域邮件重置

**Files:**
- Create: `functions/projects/income-forecast/api/password/forgot.ts`
- Create: `functions/projects/income-forecast/api/password/reset.ts`
- Create: `functions/projects/income-forecast/api/password/change.ts`
- Create: `supabase/templates/recovery.html`
- Create: `tests/function-password.test.ts`
- Create: `docs/runbooks/income-forecast-auth.md`

**Interfaces:**
- Produces:
  - `POST /api/password/forgot` with `{name, employeeSuffix?}`
  - `POST /api/password/reset` with `{tokenHash, password}`
  - `POST /api/password/change` with `{currentPassword, newPassword}`

- [ ] **Step 1: 写姓名匹配、脱敏和限流失败测试**

覆盖唯一姓名、未知姓名、未来重名、工号后四位错误、60 秒第二次、1 小时第 11 次、SMTP 失败和成功文案。成功结果必须精确包含：

```text
重置信息已发送。请前往您的邮箱：wan***ao@chinatelecom.cn，查看收件箱或垃圾邮件，并按邮件提示重置密码。
```

- [ ] **Step 2: 运行测试确认三个密码 Route 尚不存在**

Run: `npm test -- --run tests/function-password.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现忘记密码**

每个规范化姓名请求先执行 60 秒/1 小时 HMAC 限流，无论匹配与否都计数。唯一启用用户直接使用登记邮箱；多条记录返回 `{status:"needs_employee_suffix"}`，然后用工号后四位精确定位。调用 Supabase `resetPasswordForEmail()` 并把 `redirectTo` 固定为自有重置页；只有 SMTP 接受后返回 `{status:"sent", maskedEmail}`。

- [ ] **Step 4: 实现同域 Token Hash 重置和主动改密**

重置 Route 用 `verifyOtp({ token_hash: tokenHash, type: "recovery" })` 验证一次性令牌，再调用 `updateUser({password})`。主动改密先用当前手机号和 `currentPassword` 重新认证，再更新密码。两条成功路径都把 `profiles.uses_initial_password=false`、`must_change_password=false`，并撤销旧会话后建立新会话。

- [ ] **Step 5: 写不含 Supabase 域名的邮件模板和运维手册**

模板链接固定为：

```html
<a href="https://hwang0310.dpdns.org/projects/income-forecast/reset-password/?token_hash={{ .TokenHash }}&type=recovery">重置密码</a>
```

手册说明 163 SMTP Host、端口、发件地址和授权码应填的 Dashboard 页面，但授权码字段只写“由王昊在官方后台填写”，不写真实值；同时记录 DBeaver 使用 Supavisor Session Pooler、Auth/Storage 不直改系统表。

- [ ] **Step 6: 运行密码流程测试**

Run: `npm test -- --run tests/function-password.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 7: 提交密码流程**

```bash
git add functions/projects/income-forecast/api/password supabase/templates/recovery.html tests/function-password.test.ts docs/runbooks/income-forecast-auth.md
git commit -m "feat: add zero-cost email password recovery"
```

---

### Task 7: 实现报告清单 API 和私有 Storage 网关

**Files:**
- Create: `functions/_lib/reports.ts`
- Create: `functions/projects/income-forecast/api/reports.ts`
- Create: `functions/projects/income-forecast/reports/[[path]].ts`
- Create: `public/_routes.json`
- Create: `tests/function-reports.test.ts`

**Interfaces:**
- Produces: `GET /api/reports` 和原固定报告路径的鉴权流式代理。

- [ ] **Step 1: 写公开、私有、穿越和缓存失败测试**

```ts
expect(await requestReport("2026/07/20/index.html", null)).toUseAssets();
expect(await requestReport("2026/07/24/index.html", null)).toRedirectToLogin();
expect(await requestReport("2026/07/24/index.html", user)).toStreamPrivateObject();
expect(await requestReport("2026/07/24/%2e%2e/secret", user)).toHaveStatus(400);
expect(privateResponse.headers.get("Cache-Control")).toBe("private, no-store");
```

- [ ] **Step 2: 运行测试确认报告网关尚不存在**

Run: `npm test -- --run tests/function-reports.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现报告日期和对象路径解析**

只接受 `/reports/YYYY/MM/DD/` 下的非空相对文件路径；目录 URL 映射为 `index.html`。解码后拒绝 `.`、`..`、反斜线、NUL、双重编码穿越和超过长度限制的路径。Content-Type 使用显式扩展名表，不采用用户输入的响应头。

- [ ] **Step 4: 实现列表和私有下载**

匿名列表由 `PUBLIC_REPORT_DATES` 直接生成，不依赖 Supabase。登录用户从 `reports where status='online'` 获取全部记录。`mustChangePassword=true` 的用户只能访问改密 API，报告列表和私有对象返回 403。私有对象使用 Service Role `storage.from(bucket).download(prefix + objectPath)`，404 不去静态目录回退。Supabase 超时或暂停时，匿名公共清单继续返回，两期公共静态文件继续工作；私有列表和对象返回 503 维护响应，绝不返回公共同名文件。

当请求私有报告的 `assets/archive-manifest.js` 时，网关根据当前可见报告动态生成 `window.INCOME_FORECAST_ARCHIVE = ...;`，从而保留旧报告页面的年/月/日选择器；Storage 中的同名文件不直接返回。

- [ ] **Step 5: 限定 Functions 调用范围**

`public/_routes.json` 写为：

```json
{
  "version": 1,
  "include": [
    "/projects/income-forecast/api/*",
    "/projects/income-forecast/reports/*"
  ],
  "exclude": [
    "/projects/income-forecast/reports/2026/07/20/*",
    "/projects/income-forecast/reports/2026/07/25/*"
  ]
}
```

两期公开路径直接命中静态资源，即使 Supabase 不可用仍可浏览；其他报告在 Functions 额度耗尽时也因静态构建中不存在而无法泄露。

- [ ] **Step 6: 运行报告安全测试**

Run: `npm test -- --run tests/function-reports.test.ts tests/income-policy.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 7: 提交报告网关**

```bash
git add functions/_lib/reports.ts functions/projects/income-forecast/api/reports.ts 'functions/projects/income-forecast/reports/[[path]].ts' public/_routes.json tests/function-reports.test.ts
git commit -m "feat: proxy authenticated private reports"
```

---

### Task 8: 重建收入预估入口、登录和密码页面

**Files:**
- Delete: `public/projects/income-forecast/index.html`
- Create: `projects/income-forecast/index.html`
- Create: `projects/income-forecast/reset-password/index.html`
- Create: `src/income-forecast/client.ts`
- Create: `src/income-forecast/reset-password.ts`
- Create: `src/income-forecast/styles.css`
- Modify: `vite.config.ts`
- Create: `tests/income-ui.test.ts`

**Interfaces:**
- Consumes: Session、Password、Reports API。
- Produces: 匿名公开示例、手机号登录、忘记密码、登录后完整归档、初始密码提示。

- [ ] **Step 1: 写无 JavaScript和交互契约失败测试**

测试 HTML 默认包含项目说明、手机号/密码标签、忘记密码按钮、`20260720` 和 `20260725` 两张可访问卡片；不能包含私有报告 URL。客户端测试 Mock API 后验证登录成功遵守安全 `next`、初始密码只提示不阻断、SMTP 成功才显示脱敏邮箱。

- [ ] **Step 2: 运行 UI 测试确认旧静态页不满足登录契约**

Run: `npm test -- --run tests/income-ui.test.ts`

Expected: FAIL。

- [ ] **Step 3: 将收入入口纳入 Vite 多页构建**

`vite.config.ts` 使用 `resolve()` 明确三个输入：根 `index.html`、收入入口、重置页；输出仍保持 `/projects/income-forecast/.../index.html`。删除 `public` 下旧入口，避免同一路径双份文件覆盖。

- [ ] **Step 4: 实现渐进增强入口**

页面初始 HTML 在无 JS 时仍能打开两期公共示例。JS 启动后 GET Session 和 Reports：匿名显示登录区及公共卡片；登录显示全量年/月/日选择器、用户菜单、退出和改密入口；`usesInitialPassword` 只显示建议提示；`mustChangePassword` 显示阻断式改密面板，不展示私有报告。

- [ ] **Step 5: 实现忘记密码和重置页**

忘记密码只询问姓名；API 返回重名状态后再出现“工号后四位”。成功后显示“请前往您的邮箱：xxxx”。重置页只从查询参数读取 `token_hash` 和固定 `type=recovery`，提交后清理 URL 中的令牌并跳回登录。

- [ ] **Step 6: 做响应式和无障碍样式**

保持现有深色报告视觉，所有输入有可见 Label、错误用 `aria-live`、键盘焦点清晰，360px 不横向溢出；不加载外部字体、验证码或第三方脚本。

- [ ] **Step 7: 运行 UI、构建和类型检查**

Run: `npm test -- --run tests/income-ui.test.ts && npm run typecheck && npm run build`

Expected: PASS；`dist/projects/income-forecast/index.html` 和重置页存在，私有静态目录不存在。

- [ ] **Step 8: 提交入口页面**

```bash
git add public/projects/income-forecast projects/income-forecast src/income-forecast vite.config.ts tests/income-ui.test.ts
git commit -m "feat: add income report login experience"
```

---

### Task 9: 实现王昊管理 API 和日常数据后台

**Files:**
- Create: `functions/projects/income-forecast/api/admin/users.ts`
- Create: `functions/projects/income-forecast/api/admin/users/[id].ts`
- Create: `functions/projects/income-forecast/api/admin/reports.ts`
- Create: `functions/projects/income-forecast/api/admin/reports/[date].ts`
- Create: `functions/projects/income-forecast/api/admin/audit.ts`
- Create: `projects/income-forecast/admin/index.html`
- Create: `src/income-forecast/admin.ts`
- Modify: `vite.config.ts`
- Create: `tests/function-admin.test.ts`
- Create: `tests/admin-ui.test.ts`

**Interfaces:**
- Produces: `/projects/income-forecast/admin/` 和只允许 `admin/root_admin` 的人员、报告、容量、审计 API。

- [ ] **Step 1: 写普通用户越权和最高管理员保护失败测试**

测试普通用户所有 Admin API 返回 403；管理员可读但不能停用/降级 `root_admin`；王昊不能停用自己；公共日期不能删除、取消置顶或改成私有；管理员永远看不到 `encrypted_password`、密码哈希或令牌。

- [ ] **Step 2: 运行测试确认管理模块尚不存在**

Run: `npm test -- --run tests/function-admin.test.ts tests/admin-ui.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现人员 API**

列表只返回姓名、工号脱敏展示、手机号脱敏展示、邮箱脱敏展示、角色、启用状态、初始密码提示状态和最近更新时间。PATCH 使用动作枚举：

```ts
type UserAdminAction =
  | { action: "set_active"; active: boolean }
  | { action: "send_reset" }
  | { action: "require_password_change"; required: boolean };
```

停用用户前调用 Auth Admin API 撤销会话；发送重置复用 Task 6 服务；所有动作写审计。

- [ ] **Step 4: 实现报告、容量和审计 API**

报告列表同时返回 `privateUsedBytes`、`onlineTotalBytes`、`softLimitBytes`、`freeTierReferenceBytes`、`nextEvictionDate` 和 `lastCleanup`。PATCH 只支持私有报告置顶/取消置顶和明确下线；两期公共日期立即 409。审计查询限制页大小、排序和允许的筛选字段。

- [ ] **Step 5: 实现管理员 UI**

四个区域为人员、报告、容量、审计；默认先显示只读摘要，危险按钮二次确认。容量同时标示“Supabase 私有约 1.1 MiB”和“全部在线约 2.1 MiB”迁移初始口径，并以实际 API 为准。页面没有任何密码查看或设置任意明文密码的控件。

- [ ] **Step 6: 运行管理员测试**

Run: `npm test -- --run tests/function-admin.test.ts tests/admin-ui.test.ts && npm run typecheck && npm run build`

Expected: PASS。

- [ ] **Step 7: 提交管理后台**

```bash
git add functions/projects/income-forecast/api/admin projects/income-forecast/admin src/income-forecast/admin.ts vite.config.ts tests/function-admin.test.ts tests/admin-ui.test.ts
git commit -m "feat: add income access administration"
```

---

### Task 10: 创建私有桶并从 XLSX 幂等导入 16 人

**Files:**
- Create: `scripts/provision-income-forecast.mjs`
- Create: `scripts/import-income-users.mjs`
- Create: `tests/provision-income-forecast.test.ts`
- Create: `tests/roster-import.test.ts`
- Modify: `package.json`
- Modify: `docs/runbooks/income-forecast-auth.md`

**Interfaces:**
- Produces:
  - `provisionIncomeForecast(client): Promise<void>`
  - `readRoster(path): Promise<RosterPerson[]>`
  - `syncRoster(client, people, {apply}): Promise<SyncSummary>`

- [ ] **Step 1: 写 XLSX 结构、唯一性和 Dry Run 失败测试**

测试在临时目录用 ExcelJS 创建不含真实 PII 的工作簿，表头精确为 `姓名/工号/电话号码/邮箱/是否管理员`。覆盖缺表头、重复工号、重复手机号、无效邮箱、非 11 位手机号、没有王昊最高管理员、默认不产生远端调用和 `--apply` 幂等。

- [ ] **Step 2: 运行测试确认导入器尚不存在**

Run: `npm test -- --run tests/provision-income-forecast.test.ts tests/roster-import.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现幂等 Storage Provisioning**

用 Supabase Storage API 检查 `income-forecast-reports`；不存在时创建私有桶，已存在但为公共桶时安全失败，不能自动改为公共。单文件上限设为 25 MiB，允许 `text/html`、`text/css`、`text/javascript`、`application/javascript`、SVG、PNG、JPEG、WebP、GIF、ICO、WOFF、WOFF2；不直接 INSERT/UPDATE `storage.buckets` 或 `storage.objects`。

- [ ] **Step 4: 实现默认 Dry Run 的人员导入**

入口默认读取用户指定原文件：

```text
/Users/hwang/Movies/Program/hwang_sryg/收入预估2.0人员权限清单.xlsx
```

Dry Run 只输出人数、管理员数、待创建/待更新数量和脱敏冲突；`--apply` 才调用 Auth Admin `createUser({phone,email,password:phone,phone_confirm:true,email_confirm:true,app_metadata:{role}})` 并 upsert Profile。已存在手机号只同步 Profile/角色，不重设密码。姓名为王昊且清单标记管理员时写 `root_admin`，其他管理员写 `admin`。

- [ ] **Step 5: 防止 PII 和秘密进入输出/仓库**

日志不得打印完整手机号、邮箱或初始密码；测试扫描 stdout/stderr。`.gitignore` 覆盖 `.xlsx`、`.dev.vars`、Supabase 临时目录，但不能误忽略源码测试。脚本缺少 Service Role 时在任何远端调用前失败。

- [ ] **Step 6: 运行导入测试和 Dry Run**

Run:

```bash
npm test -- --run tests/provision-income-forecast.test.ts tests/roster-import.test.ts
node scripts/import-income-users.mjs --roster '/Users/hwang/Movies/Program/hwang_sryg/收入预估2.0人员权限清单.xlsx'
```

Expected: 单元测试 PASS；真实 Dry Run 报告 16 人、至少 1 名管理员，不打印完整 PII。

- [ ] **Step 7: 提交 Provisioning 和导入器**

```bash
git add scripts/provision-income-forecast.mjs scripts/import-income-users.mjs tests/provision-income-forecast.test.ts tests/roster-import.test.ts package.json package-lock.json docs/runbooks/income-forecast-auth.md .gitignore
git commit -m "feat: provision private reports and roster users"
```

---

### Task 11: 建立网站端到端与生产探测门禁

**Files:**
- Create: `tests/e2e/income-forecast.spec.ts`
- Modify: `tests/e2e/homepage.spec.ts`
- Modify: `playwright.config.ts`
- Create: `scripts/verify-income-forecast-production.mjs`
- Modify: `tests/static-staging.test.ts`

**Interfaces:**
- Produces: 本地浏览器回归和不泄露凭据的生产验收命令。

- [ ] **Step 1: 把旧 E2E 的四期全公开断言改成双公开**

```ts
const publicReports = ["20260720", "20260725"];
const privateReports = ["20260724", "20260726"];
```

公共路径期望 200；本地 Vite 静态预览中的私有路径必须 404，证明构建物没有私有副本。API 交互用 Playwright Route Mock 驱动普通用户和管理员页面，不把真实账号放进测试。

- [ ] **Step 2: 运行 E2E 确认旧断言失败**

Run: `npm run build && npm run test:e2e -- --project=desktop-chromium`

Expected: 旧四期公开断言失败。

- [ ] **Step 3: 覆盖匿名、普通用户、管理员和移动端**

用例必须验证：匿名两张公开卡、私有锁定；登录回到 `next`；初始密码提示不阻断；强制改密阻断私有访问；普通用户无 Admin；管理员容量分口径；忘记密码显示脱敏邮箱；360px 无横向滚动。

- [ ] **Step 4: 实现生产探测脚本**

脚本默认只做匿名探测：主页、项目入口、两期公开示例必须 200，两个私有目录及其 CSS/JS 子路径不得返回 200。仅在环境提供测试账号时做登录探测，日志只显示日期和状态码，不显示 Cookie、手机号、邮箱或 Token。

- [ ] **Step 5: 运行网站完整测试**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected: 全部 PASS，`dist` 中没有 `/24/`、`/26/`。

- [ ] **Step 6: 提交网站验收门禁**

```bash
git add tests/e2e tests/static-staging.test.ts playwright.config.ts scripts/verify-income-forecast-production.mjs
git commit -m "test: lock income report access boundaries"
```

---

### Task 12: 为 Skill 实现 Supabase 私有版本化发布

**Files:**
- Create: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/publishing_policy.py`
- Create: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/credential_provider.py`
- Create: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/supabase_publish.py`
- Create: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_private_publish.py`

**Interfaces:**
- Produces:
  - `PublishingPolicy`
  - `CredentialProvider.get(name: str) -> str`
  - `inventory_report(report_dir: Path) -> ReportInventory`
  - `publish_private_report(report_date, report_dir, archive_entries, client, policy) -> PrivatePublishResult`

- [ ] **Step 1: 写发布白名单和清理回滚失败测试**

```python
self.assertEqual(PUBLIC_REPORT_DATES, ("20260720", "20260725"))
self.assertEqual(PRIVATE_SOFT_LIMIT_BYTES, 850 * 1024 * 1024)
```

Fake Storage/PostgREST 覆盖：非法扩展名、符号链接、绝对路径泄露、上传中断、逐文件校验、最老未置顶选择、跳过公共/置顶、清理中断恢复、元数据最后激活、超过 1 GB 操作硬边界直接失败。

- [ ] **Step 2: 运行测试确认发布模块尚不存在**

Run: `/opt/miniconda3/bin/python3 -m unittest tests.test_private_publish -v`

Expected: FAIL with import error。

- [ ] **Step 3: 实现凭据来源**

先读 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`；缺失时在 macOS 用 `security find-generic-password` 读取服务名 `hwang0310-income-forecast-supabase`。只返回内存字符串，不打印命令输出；两种来源都没有时在网络调用前失败。移植环境可只用环境变量。

- [ ] **Step 4: 实现报告 Inventory 和上传版本**

只允许 `.html/.css/.js/.svg/.png/.jpg/.jpeg/.webp/.gif/.ico/.woff/.woff2`，拒绝符号链接、隐藏缓存、Word、Excel、Python、独立 JSON 和本地绝对路径。Storage 前缀为：

```text
reports/YYYY/MM/DD/<release-uuid>/
```

上传后逐项检查对象路径、字节数和 SHA-256；只有全部匹配才进入容量阶段。

- [ ] **Step 5: 实现可恢复清理和最后激活**

同时读取 DB 在线私有用量和 Storage 桶实际对象用量；硬边界使用包含未激活暂存的实际桶用量。若 `actual_bucket_bytes + incoming > 1_000_000_000`，不删除旧报告并安全失败，同时报告需要人工处理的孤立暂存前缀。若激活后在线报告超过 850 MiB，选择最老且未置顶的私有报告；只有本地 `ArchiveEntry` 可恢复时才能清理。任一删除失败时用本地权威副本恢复已删前缀、删除新暂存并保持旧 DB 清单；全部 Storage 操作成功后调用 `finalize_report_publish` 一次提交新记录和清理日期。

- [ ] **Step 6: 运行私有发布测试**

Run: `/opt/miniconda3/bin/python3 -m unittest tests.test_private_publish -v`

Expected: PASS。

---

### Task 13: 改造 Skill 路由、公共部署和在线选择器兼容

**Files:**
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/run_pipeline.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/build_deploy_bundle.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/publish_pages.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/assets/common.js`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_pipeline.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_deploy_bundle.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_html_report.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_skill_contract.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/SKILL.md`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/references/cloudflare-publishing.md`

**Interfaces:**
- Consumes: Task 12 的 `publish_private_report()`。
- Produces: `run_pipeline(..., publish=True)` 对白名单日期走公共部署，其他日期走私有发布。

- [ ] **Step 1: 写日期路由和禁止公开回退失败测试**

测试 `20260720/20260725` 调用 Public Publisher；`20260724/20260726/未来日期` 只调用 Private Publisher；私有配置缺失时抛出错误，Public Publisher 调用次数保持 0；普通私有发布不要求 `site_base`。

- [ ] **Step 2: 运行 Skill 定向测试确认旧流水线始终走 Cloudflare**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest tests.test_pipeline tests.test_deploy_bundle tests.test_skill_contract -v
```

Expected: FAIL，证明旧 `--publish` 仍把全部报告组装进整站。

- [ ] **Step 3: 重写 `run_pipeline` 发布分支**

本地产物生成、验证、原子留档和本地 Manifest 同步保持原顺序。发布分支改为：

```python
if report_date in PUBLIC_REPORT_DATES:
    result = publish_public_report(final_entries, site_base, site_repository)
else:
    result = publish_private_report(
        report_date,
        final_html,
        final_entries,
        client,
        DEFAULT_POLICY,
    )
```

CLI 保留 `--publish`；`--site-base` 和新增 `--site-repository` 只在重发公共白名单时必需。普通私有发布缺 Supabase 凭据时安全失败，不能调用旧 bundle 或 Wrangler。

- [ ] **Step 4: 让公共 bundle 只包含两期白名单并带 Functions**

`build_deploy_bundle()` 过滤掉所有私有日期并验证两期公共报告存在；`publish_pages()` 新增 `site_repository`，校验仓库根 `functions/`、`package.json` 和完整 `dist/index.html`，然后以 `cwd=site_repository` 调用：

```text
npx wrangler pages deploy <bundle> --project-name hwang0310-site --branch main
```

这样 Wrangler 能按官方 Direct Upload 规则上传根目录 `functions/`。发布前后继续比较收入路径之外 SHA-256。

- [ ] **Step 5: 保持在线和离线日期选择器**

本地生成报告继续写含 `localPath` 的完整离线 Manifest。扩展现有 `sync_local_manifests()` 为原子 `sync_local_runtime()`：除同步 Manifest 外，还把本 Skill 已测试的最新版 `assets/site-template/assets/common.js` 同步到每个有效本地 HTML 报告，使四期旧报告和未来报告使用同一选择器逻辑。

`common.js` 在 `file:` 本地打开时只使用包含 `localPath` 的离线 Manifest；在 HTTP(S) 同源页面中先展示静态 Manifest，再以 `credentials: "same-origin"` 请求 `/projects/income-forecast/api/reports` 并刷新选择器。请求失败时保留静态可见日期且不破坏当前报告。公开构建的静态 Manifest 只写两期公开 Web Path；私有线上报告的 Manifest 请求仍可由 Task 7 网关动态生成。不得加入浏览器直连 Supabase 的 Fetch。

- [ ] **Step 6: 更新 Skill 文档契约**

明确写出双公开白名单、850 MiB、普通日期私有发布、日常发布不重部署主页、Service Role 只来自环境/钥匙串、认证失败禁止公开回退，以及公共重发时必须提供完整网站仓库和构建目录。

- [ ] **Step 7: 运行 Skill 全量回归**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest discover -s /Users/hwang/.codex/skills/income-forecast-2-0/tests -v
python3 /Users/hwang/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/hwang/.codex/skills/income-forecast-2-0
```

Expected: 全部 PASS。

---

### Task 14: 同步 Skill 主库、移植副本和 ZIP

**Files:**
- Sync: `/Users/hwang/.codex/skills/income-forecast-2-0`
- Replace portable copy: `/Users/hwang/Movies/SKILLS/income-forecast-2-0`
- Replace archive: `/Users/hwang/Movies/SKILLS/income-forecast-2-0.zip`

**Interfaces:**
- Consumes: Task 12–13 已验证的主库。
- Produces: 三份内容一致且不含运行状态/凭据的 Skill。

- [ ] **Step 1: 生成三份文件清单并确认排除项**

排除 `.git`、`.wrangler`、`.openai`、`__pycache__`、`.pyc`、凭据、环境文件、用户 XLSX、报告产物和测试临时目录。先把目标文件列表写到临时目录比较，不直接删除未解析目标。

- [ ] **Step 2: 同步主库到移植副本并重建 ZIP**

只在确认目标是精确路径 `/Users/hwang/Movies/SKILLS/income-forecast-2-0` 后替换其内容；ZIP 从验证后的移植副本创建，ZIP 根目录保持 `income-forecast-2-0/`。

- [ ] **Step 3: 比较清单和 SHA-256**

主库与移植副本逐文件相对路径和 SHA-256 必须完全相等；解压 ZIP 到 `mktemp -d` 后做第三次同样比较。

- [ ] **Step 4: 在移植副本和解压副本重复快速验证**

Run:

```bash
python3 /Users/hwang/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/hwang/Movies/SKILLS/income-forecast-2-0
```

Expected: PASS，扫描不到凭据或人员源数据。

---

### Task 15: 迁移现有账户和报告并部署预览

**Files:**
- Remote: Supabase project `dcymydheijnbqciemlzn`
- Remote: Cloudflare Pages project `hwang0310-site`
- Local sources: 四期已验证 HTML 报告和原始人员 XLSX

**Interfaces:**
- Consumes: 所有网站和 Skill 代码。
- Produces: 可回滚的预览环境、16 个 Auth 用户、两期公共/两期私有报告。

- [ ] **Step 1: 记录切换前只读基线**

保存当前 Pages 部署 ID、关键 URL 状态、`dist` 边界外哈希、Supabase 项目健康状态和 Storage 用量。记录不包含 Token、手机号、邮箱或密码。

- [ ] **Step 2: 推送数据库迁移并运行远端验收**

Run:

```bash
npx supabase db push --linked
npx supabase migration list --linked
npx supabase db advisors --linked
```

执行只读 SQL 验证四表、RLS、RPC 和公共保护触发器。任何错误停止，不进入用户导入。

- [ ] **Step 3: Provision 私有桶并导入用户**

先运行 Provision，再对真实 XLSX 运行 Dry Run；确认 16 人和王昊 `root_admin` 后运行 `--apply`。抽查王昊和一个普通用户：Auth 同时具有手机号、企业邮箱和正确 `app_metadata`，Profile 没有密码字段。

- [ ] **Step 4: 由用户在官方后台填写 SMTP 授权码**

在 Supabase Authentication SMTP 配置中填写现有 163 发件邮箱和授权码，应用仓库中的 Recovery 模板和自有域名 Redirect URL。授权码由王昊直接填入官方页面；终端、Codex 消息和仓库不接触该值。

- [ ] **Step 5: 配置 Cloudflare Pages 变量和秘密**

用 Wrangler 当前 `pages secret --help` 核对命令后，以交互式秘密输入执行：

```bash
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name hwang0310-site
npx wrangler pages secret put RATE_LIMIT_HMAC_SECRET --project-name hwang0310-site
```

第二项使用随机 32 字节以上的秘密。把 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SITE_ORIGIN=https://hwang0310.dpdns.org`、`SUPABASE_STORAGE_BUCKET=income-forecast-reports` 作为非秘密项目变量。`SITE_ORIGIN` 仅生成正式重置邮件链接，CSRF 同源判断使用请求自身 Origin。不要把值写进 `wrangler.toml`、`.dev.vars`、shell 历史或命令参数。预览和生产环境都做一次只显示变量名、不显示值的绑定检查。

- [ ] **Step 6: 上传两期私有报告并登记四期元数据**

先对四期有效本地 HTML 调用 Task 13 的 `sync_local_runtime()`，让旧报告取得同源在线清单兼容逻辑，并重新执行 HTML 验证；这一步不改 Word、Excel 或报告数据。随后让 `20260724`、`20260726` 走 Task 12 私有发布；`20260720`、`20260725` 只登记为 `public + pinned + online`，文件留在 Cloudflare。核对私有初始用量约 1.1 MiB、全部在线约 2.1 MiB，以实际清单字节数为准。

- [ ] **Step 7: 构建并部署 Cloudflare 预览**

从网站仓库根目录运行 `npm run build`，确认 `dist` 只有两期公开文件，再用 Wrangler 部署预览分支。因为命令工作目录有 `functions/`，预览必须同时包含静态资源和 Pages Functions。

- [ ] **Step 8: 验证预览安全边界**

匿名访问两期公开报告为 200；私有报告 HTML、CSS、JS、图片直达均不能返回内容；普通账户登录后可访问私有全省页和武汉页；王昊可访问 Admin；普通用户 Admin 为 403；Supabase 停止/Mock 失败时公开示例仍工作。

- [ ] **Step 9: 完成一次正式找回邮件测试**

用王昊姓名触发找回，页面显示登记企业邮箱的正确脱敏形式；确认企业邮箱收到邮件、链接只打开自有域名、Token 使用一次后失效、新密码能登录。随后根据用户要求保留新密码，不记录或回显。

---

### Task 16: 生产切换、全量验证和公开 GitHub 同步

**Files:**
- Commit: website repository source and plan status
- Sync to: `/Users/hwang/Movies/Codex工作空间/hwang0310-site-public`
- Push: `https://github.com/HWang0310/hwang0310-site.git`
- Deploy: `https://hwang0310.dpdns.org/`

**Interfaces:**
- Produces: 生产站点、公开源码、验证记录和可回滚部署 ID。

- [ ] **Step 1: 运行所有本地门禁**

```bash
cd /Users/hwang/Movies/Codex工作空间/hwang0310-site
npm test
npm run typecheck
npm run build
npm run test:e2e
/opt/miniconda3/bin/python3 -m unittest discover -s /Users/hwang/.codex/skills/income-forecast-2-0/tests -v
python3 /Users/hwang/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/hwang/.codex/skills/income-forecast-2-0
```

Expected: 全部 PASS。

- [ ] **Step 2: 做凭据、PII 和私有文件扫描**

扫描网站源码、`dist`、Skill 三份和待推送公共仓库：不得出现真实人员清单文件、16 人完整手机号/邮箱、密码、Token、Service Role、163 授权码、`.dev.vars`、私有报告静态目录。允许公开联系邮箱 `hwang0310@163.com` 和设计文档中的路径说明。

- [ ] **Step 3: 部署生产且保留回滚 ID**

从网站仓库根目录运行 Wrangler Pages 生产部署，确认输出项目为 `hwang0310-site`、分支 `main`。若任一验证失败，回滚至 Task 15 记录的上一个健康部署；不能通过重新公开私有目录应急。

- [ ] **Step 4: 运行生产探测和人工浏览器验收**

Run: `npm run verify:income -- --origin https://hwang0310.dpdns.org`

再人工检查主页座右铭位于联系方式上方、两期公开报告、登录回跳、私有全省/武汉、管理员容量、退出、会话过期、移动端和打印。检查生产网络中没有浏览器直连 Supabase、Google 或 Turnstile。

- [ ] **Step 5: 提交最终网站源码**

```bash
git add .
git diff --cached --check
git commit -m "feat: protect income forecast reports"
```

提交前确认没有把 `dist`、人员 XLSX、`.dev.vars` 或秘密加入索引。

- [ ] **Step 6: 先 Dry Run 再同步公共源码仓库**

确认 `/Users/hwang/Movies/Codex工作空间/hwang0310-site-public` 工作树干净；用明确排除 `.git`、`node_modules`、`dist`、环境文件、人员清单和私有报告的同步命令先执行 `--dry-run`。人工审查删除/新增清单后再同步，保留公共仓库自身 `.git`。

- [ ] **Step 7: 在公共副本重复测试和秘密扫描**

Run:

```bash
cd /Users/hwang/Movies/Codex工作空间/hwang0310-site-public
npm ci
npm test
npm run typecheck
npm run build
```

确认公共副本构建也只包含 `20260720`、`20260725`，Functions 源码不含环境值。

- [ ] **Step 8: 提交并推送公开仓库**

```bash
git add .
git diff --cached --check
git commit -m "feat: add private income report access"
git push origin main
```

最后打开 `https://github.com/HWang0310/hwang0310-site` 验证仓库公开、最新提交存在且秘密扫描仍通过。

- [ ] **Step 9: 记录最终交付**

记录网站提交、公共仓库提交、Cloudflare 生产部署 URL/ID、Supabase Migration 版本、Skill 三份哈希、测试统计和关键路由结果。报告中不包含账户密码、SMTP 授权码、Service Role、Cookie 或完整人员资料。
