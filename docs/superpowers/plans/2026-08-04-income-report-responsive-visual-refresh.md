# 收入预估报告响应式与视觉升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把收入预估全省页和 17 个地市页升级成不横向跑版、适合手机/平板/电脑的专业数据工作台，并让当前、旧有和未来由 `income-forecast-2-0` 生成的报告永久继承同一新版模板。

**Architecture:** 以 `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template` 为唯一 UI 来源，在生成链路写入版本标记，以 CSS 容器/断点解决布局，以 `common.js` 做表格滚动提示等渐进增强。原登录项目 Task 13 产生的 `sync_local_runtime()` 扩展为同步 Manifest、`styles.css` 和 `common.js`，再由网站 Playwright 对真实 20260725 全省页和武汉页执行五档视口验收。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Python 3.13 `unittest`、Node.js 22、Playwright 1.62、Vite 6。

## Global Constraints

- 本计划在 `2026-08-04-income-forecast-auth-and-private-reports.md` 的 Task 13 完成后、Task 14 开始前执行。
- 模板唯一权威目录固定为 `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template`。
- 不新增前端框架、CDN、远程字体、远程脚本或外部图片；报告继续支持本地 `file:` 打开。
- 全省页和地市页原有数据、17 地市、日期选择、主题、打印、地图、图表和表格功能必须保留。
- 页面在 360、390、768、1024、1440px 下不得整页横向滚动；只允许 `.table-scroll` 局部横向滚动。
- 手机端正文不小于 13px，主要按钮和下拉框最小触控高度 44px。
- 深色、浅色、打印和 `prefers-reduced-motion` 都必须有明确样式。
- `INCOME_REPORT_UI_VERSION` 固定为 `2026.08-responsive-1`；修改版本必须同时更新测试，不允许隐式漂移。
- `sync_local_runtime()` 必须原子同步 `archive-manifest.js`、`styles.css` 和 `common.js`；任一项失败时不能发布混合版本。
- Skill 主库验证完成后，仍由原计划 Task 14 同步 `/Users/hwang/Movies/SKILLS/income-forecast-2-0` 和 ZIP。

---

## File Structure

### Skill 主库 `/Users/hwang/.codex/skills/income-forecast-2-0`

- `scripts/create_report.py`：UI 版本单一来源、传给生成器并写入 `report-meta.js`。
- `assets/site-template/generate-report-site.mjs`：在页面 `<meta>`、`body[data-ui-version]` 中写版本，并保持现有语义结构。
- `assets/site-template/assets/styles.css`：流体容器、视觉 token、1024/640/390 断点、局部表格滚动、地图、触控、打印和减少动效。
- `assets/site-template/assets/common.js`：声明运行时版本、增强表格滚动提示并保持地图/日期/主题原逻辑。
- `scripts/run_pipeline.py`：Task 13 的 `sync_local_runtime()` 扩展为三项资源原子同步和版本校验。
- `tests/test_responsive_template.py`：版本、CSS、JS 和生成输出的静态/生成契约。
- `tests/test_pipeline.py`：旧报告同步、失败回滚和公共/私有发布前门禁。
- `tests/test_html_report.py`：新报告页面和 `report-meta.js` 版本一致性。

### 网站仓库 `/Users/hwang/Movies/Codex工作空间/hwang0310-site/.worktrees/income-forecast-auth`

- `tests/e2e/income-report-responsive.spec.ts`：真实公开报告的全省/武汉跨设备浏览器验收。
- `playwright.config.ts`：只在现有配置不能表达 360/390/768/1024/1440 时增加命名项目；优先由测试内设置视口，避免扩大所有旧测试矩阵。

---

### Task 1: 建立 UI 版本与响应式静态契约

**Prerequisite:** 原登录项目 Task 13 已完成，`sync_local_runtime()` 已存在。

**Files:**
- Create: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_responsive_template.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_html_report.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/create_report.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/generate-report-site.mjs`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/assets/styles.css`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/assets/common.js`

**Interfaces:**
- Produces: `INCOME_REPORT_UI_VERSION: str = "2026.08-responsive-1"`。
- Produces: 所有新页面包含 `meta[name="income-report-ui-version"]` 与 `body[data-ui-version]`。
- Produces: `window.INCOME_REPORT_UI_VERSION = "2026.08-responsive-1"` 和 CSS 首行版本注释。

- [ ] **Step 1: 写 UI 版本的失败测试**

创建 `test_responsive_template.py`，直接读取模板并断言实际标记，不使用只匹配文件名的弱测试：

```python
from pathlib import Path
import unittest

SKILL_ROOT = Path(__file__).resolve().parents[1]
CSS = (SKILL_ROOT / "assets/site-template/assets/styles.css").read_text("utf-8")
JS = (SKILL_ROOT / "assets/site-template/assets/common.js").read_text("utf-8")

class ResponsiveTemplateContractTest(unittest.TestCase):
    def test_runtime_assets_share_the_pinned_ui_version(self):
        self.assertIn("income-report-ui-version: 2026.08-responsive-1", CSS)
        self.assertIn('INCOME_REPORT_UI_VERSION = "2026.08-responsive-1"', JS)
```

在 `test_html_report.py` 增加对生成结果的断言：

```python
self.assertIn('<meta name="income-report-ui-version" content="2026.08-responsive-1">', province_html)
self.assertIn('data-ui-version="2026.08-responsive-1"', province_html)
self.assertIn('data-ui-version="2026.08-responsive-1"', city_html)
self.assertEqual(report_meta["uiVersion"], "2026.08-responsive-1")
```

- [ ] **Step 2: 运行测试确认旧模板没有版本契约**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest tests.test_responsive_template tests.test_html_report -v
```

Expected: FAIL，至少指出版本常量和 HTML meta/body 标记不存在。

- [ ] **Step 3: 建立版本单一来源并传给 Node 生成器**

在 `create_report.py` 定义：

```python
INCOME_REPORT_UI_VERSION = "2026.08-responsive-1"
```

把它作为生成器第五个业务参数传入；`generate-report-site.mjs` 读取 `uiVersion`，只接受 `/^[0-9]{4}\.[0-9]{2}-[a-z0-9-]+$/`，缺失或非法时抛错。在 `pageLayout()` 的 `<head>` 和 `<body>` 分别写入 meta 与 data 属性；`report-meta.js` 增加同一 `uiVersion`，不得在 JS 模板再复制第二个硬编码版本。

- [ ] **Step 4: 给运行时资源写可验证版本**

`styles.css` 首行写：

```css
/* income-report-ui-version: 2026.08-responsive-1 */
```

`common.js` IIFE 内第一条常量写：

```js
const INCOME_REPORT_UI_VERSION = "2026.08-responsive-1";
window.INCOME_REPORT_UI_VERSION = INCOME_REPORT_UI_VERSION;
```

该全局只暴露非敏感版本字符串，不保存请求或用户状态。

- [ ] **Step 5: 运行定向测试**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest tests.test_responsive_template tests.test_html_report -v
```

Expected: 全部 PASS；Task 1 不提前加入 Task 2 的布局断言。

- [ ] **Step 6: 记录外部 Skill 检查点**

Skill 主库不属于网站 Git 仓库，不能伪造 `git add`。在本任务 SDD 报告记录六个修改文件的修改前/后 SHA-256、RED/GREEN 输出和 UI 版本；后续审查员直接读取这些精确文件和测试，不把未版本化改动误称为 Git 提交。

---

### Task 2: 实现高级化响应式模板与渐进增强

**Files:**
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/assets/styles.css`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/assets/common.js`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/assets/site-template/generate-report-site.mjs`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_responsive_template.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_html_report.py`

**Interfaces:**
- Consumes: Task 1 的 `INCOME_REPORT_UI_VERSION` 和现有稳定类名。
- Produces: `setupScrollableTables()`，只在需要时设置 `.is-scrollable`、`.is-at-start`、`.is-at-end`。

- [ ] **Step 1: 把组件行为补成失败契约**

先在 `test_responsive_template.py` 增加实际 CSS 基础契约：

```python
def test_css_has_real_responsive_and_accessibility_guards(self):
    for token in (
        "min-width: 0", ".table-scroll", "position: sticky",
        "env(safe-area-inset-left)", "@media (max-width: 1024px)",
        "@media (max-width: 640px)", "@media (max-width: 390px)",
        "prefers-reduced-motion", "@media print",
    ):
        self.assertIn(token, CSS)
```

再至少断言以下组件行为：

```python
for token in (
    "setupScrollableTables", "ResizeObserver", "is-scrollable",
    "is-at-start", "is-at-end", "overscroll-behavior-inline: contain",
    ".map-shell", "aspect-ratio", ".driver-row", ".metric-card:first-child",
    "min-height: 44px", "overflow-wrap: anywhere",
):
    self.assertIn(token, CSS + JS)
```

并断言生成的全省页仍包含 `#province-map`、四张 KPI、业务表、地市排名；武汉页仍包含返回全省、地市导航、对比条和业务表，防止用删除内容“修复”适配。

- [ ] **Step 2: 运行定向测试确认行为尚未实现**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest tests.test_responsive_template tests.test_html_report -v
```

Expected: FAIL，指出滚动增强、窄屏地图或触控规则缺失。

- [ ] **Step 3: 重整视觉 token 和容器收缩边界**

保留原语义色，新增表面、sticky 背景、边缘渐隐和紧凑间距 token。以下结构必须实际存在：

```css
html, body { max-width: 100%; }
.page-shell, .content, .panel, .section-grid, .metric-grid,
.map-layout, .curve-card, .city-hero { min-width: 0; }
.page-shell {
  width: min(1440px, calc(100% - max(20px, env(safe-area-inset-left)) - max(20px, env(safe-area-inset-right))));
}
.table-wrap { min-width: 0; overflow: hidden; }
.table-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
```

修复现有重复选择器/重复属性，统一面板层级、边框、圆角和低透明度阴影；不要改变增长/风险业务颜色含义。

- [ ] **Step 4: 实现桌面、平板和手机组件规则**

在 1024px 把地图、曲线和地市 Hero 改为单列，KPI 两列；在 640px 压缩 Hero/面板并重排 Header；在 390px 保证 360px 内容边距。手机关键规则包括：

```css
@media (max-width: 640px) {
  .site-header { gap: 8px; padding-block: 8px; }
  .archive-picker select, .action-button, .province-back { min-height: 44px; }
  .map-shell, #province-map { min-height: 0; aspect-ratio: 1000 / 650; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-card:first-child { grid-column: 1 / -1; }
  .driver-row { grid-template-columns: minmax(0, 1fr) auto; }
  .driver-row .bar-track { grid-column: 1 / -1; }
  .table-scroll th:first-child, .table-scroll td:first-child {
    position: sticky; left: 0; z-index: 1; background: var(--table-sticky-bg);
  }
}
```

浅色主题覆盖 `--table-sticky-bg`；打印时取消 sticky、滚动和渐隐，展示完整表格。`prefers-reduced-motion: reduce` 关闭平滑滚动与非必要 transition。

- [ ] **Step 5: 实现表格滚动渐进增强**

在 `common.js` 增加：

```js
function setupScrollableTables() {
  document.querySelectorAll(".table-scroll").forEach((scroller) => {
    const wrap = scroller.closest(".table-wrap");
    if (!wrap) return;
    const update = () => {
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      wrap.classList.toggle("is-scrollable", max > 1);
      wrap.classList.toggle("is-at-start", scroller.scrollLeft <= 1);
      wrap.classList.toggle("is-at-end", scroller.scrollLeft >= max - 1);
    };
    scroller.addEventListener("scroll", update, { passive: true });
    new ResizeObserver(update).observe(scroller);
    update();
  });
}
```

在 DOMContentLoaded 调用它。若需要提示文本，由生成器在 `.table-wrap` 内输出 `<p class="table-scroll-hint">横向滑动查看全部指标</p>`；CSS 只在 `.is-scrollable` 时显示。不要覆盖已有日期、地图、主题或打印初始化。

- [ ] **Step 6: 运行模板与 Skill 全量测试**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest tests.test_responsive_template tests.test_html_report -v
/opt/miniconda3/bin/python3 -m unittest discover -s /Users/hwang/.codex/skills/income-forecast-2-0/tests -v
```

Expected: 全部 PASS；生成目录结构仍为 2 个全省页、17 个地市页和既定 assets。

- [ ] **Step 7: 记录外部 Skill 检查点**

在 Task 2 SDD 报告记录修改后 SHA-256、测试输出和没有新增远程资源的扫描结果：

```bash
rg -n '<(?:script|link)[^>]+(?:src|href)="https?://' /tmp/generated-income-report
```

Expected: 无匹配。

---

### Task 3: 让旧报告和未来发布都原子继承新版运行时

**Files:**
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/scripts/run_pipeline.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_pipeline.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/tests/test_deploy_bundle.py`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/SKILL.md`
- Modify: `/Users/hwang/.codex/skills/income-forecast-2-0/references/cloudflare-publishing.md`

**Interfaces:**
- Consumes: 原计划 Task 13 的 `sync_local_runtime()`。
- Produces: `sync_local_runtime(entries, template_root, ...)` 同步 Manifest、CSS、JS 并返回每份报告的资源摘要；任一失败不留下部分新版本。

- [ ] **Step 1: 写旧报告三资源同步和失败回滚测试**

用临时目录创建两份旧报告，每份含旧 `archive-manifest.js`、旧 `styles.css`、旧 `common.js`。测试成功后：

```python
self.assertEqual((report / "assets/styles.css").read_bytes(), template_css.read_bytes())
self.assertEqual((report / "assets/common.js").read_bytes(), template_js.read_bytes())
self.assertIn(b"INCOME_FORECAST_ARCHIVE", (report / "assets/archive-manifest.js").read_bytes())
```

再在第二份报告注入不可写/替换异常，断言第一份和第二份三项资源都恢复原 SHA-256，Public/Private Publisher 调用次数均为 0。

- [ ] **Step 2: 运行 pipeline 测试确认旧实现只同步 Manifest/JS**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest tests.test_pipeline tests.test_deploy_bundle -v
```

Expected: FAIL，指出 `styles.css` 未同步或故障时出现混合版本。

- [ ] **Step 3: 实现批量预检、暂存和原子替换**

`sync_local_runtime()` 先完成所有目标路径、普通文件、目录边界和模板版本预检，再为每个目标在同目录写三个临时文件并 `fsync`。全部暂存成功后依次 `os.replace`；保存原字节或同目录备份，任一 replace 失败时逆序恢复已替换目标并清理临时文件。返回结构至少包含：

```python
{
    "date": entry.date,
    "ui_version": INCOME_REPORT_UI_VERSION,
    "styles_sha256": sha256(template_css).hexdigest(),
    "common_sha256": sha256(template_js).hexdigest(),
}
```

同步必须发生在公共 bundle 构建或私有 inventory/upload 之前；失败时不调用任一 Publisher。

- [ ] **Step 4: 锁定当前四期与未来报告行为**

测试 `20260720`、`20260724`、`20260725`、`20260726` 全部被同步；发布路由仍只有 20/25 走公共，24/26/未来日期走私有。新增报告先由 `create_report.py` 获得新版资源，再进入相同同步函数，保证重跑幂等。

- [ ] **Step 5: 更新 Skill 契约文档**

在 `SKILL.md` 和发布参考明确：

- UI 版本为 `2026.08-responsive-1`；
- 本地旧报告在发布前自动升级 CSS/JS；
- 只操作收入预估报告目录和 `/projects/income-forecast/`；
- 日常私有上传不重部署个人主页；
- 运行时同步失败禁止发布，不能回退旧模板。

- [ ] **Step 6: 运行 Skill 全量与快速验证**

Run:

```bash
/opt/miniconda3/bin/python3 -m unittest discover -s /Users/hwang/.codex/skills/income-forecast-2-0/tests -v
python3 /Users/hwang/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/hwang/.codex/skills/income-forecast-2-0
```

Expected: 全部 PASS；重复运行同步测试结果相同。

- [ ] **Step 7: 记录外部 Skill 检查点**

在 Task 3 SDD 报告记录 `sync_local_runtime()` 的接口、四期测试、回滚测试和修改文件 SHA-256。不要在日志中写 Supabase、Cloudflare 或邮箱凭据。

---

### Task 4: 用真实报告完成五档浏览器验收

**Files:**
- Create: `tests/e2e/income-report-responsive.spec.ts`
- Modify only if required: `playwright.config.ts`

**Interfaces:**
- Consumes: Task 3 已同步到本地权威目录的 `20260725` 报告；`npm run build` 把公开白名单复制到 `dist`。
- Produces: 真实全省页与武汉页在五档宽度的自动回归门禁。

- [ ] **Step 1: 写真实报告布局失败测试**

创建测试辅助函数：

```ts
const viewports = [
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

async function expectNoPageOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => !element.closest(".table-scroll"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: String(element.className), left: rect.left, right: rect.right };
      })
      .filter(({ left, right }) => left < -1 || right > document.documentElement.clientWidth + 1)
      .slice(0, 20),
  }));
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.offenders).toEqual([]);
}
```

对以下 URL 循环五档视口：

```text
/projects/income-forecast/reports/2026/07/25/index.html
/projects/income-forecast/reports/2026/07/25/cities/wuhan.html
```

手机断言 `.table-scroll` 的 `scrollWidth > clientWidth`、首列 `position: sticky`、正文 `font-size >= 13`、主题/打印/日期/返回全省可见且主要控件高度 `>= 44`。

- [ ] **Step 2: 先在同步前基线运行并保留失败证据**

若 Task 3 已同步真实报告，使用修改前保存的基线截图和数值作为 RED：360px 全省页宽 556px、武汉页宽 609px。随后运行当前测试：

```bash
npm run test:e2e -- --project=desktop-chromium tests/e2e/income-report-responsive.spec.ts
```

Expected: 新模板若仍有任何非表格溢出或触控尺寸不足则 FAIL；不允许为获得 RED 回退已验证的 Skill 文件。

- [ ] **Step 3: 补齐真实内容暴露的最小布局缺口**

只回到 Skill 模板修复根因，不直接修改 `收入预估报告-20260725-html` 中的手工 CSS。每次模板修复后通过 Task 3 的 `sync_local_runtime()` 更新四期，再重建网站。不得用 `display:none` 隐藏 KPI、地图、表格列、地市导航、主题或打印控件。

- [ ] **Step 4: 验证主题、减少动效和打印**

浏览器测试切换浅色模式并检查 sticky 首列背景非透明；模拟 `reducedMotion: "reduce"` 检查 `scroll-behavior: auto` 或动画时长为 0；打印媒体下检查 Header 隐藏、表格 overflow 可见、sticky 取消且主要面板仍显示。

- [ ] **Step 5: 运行全量门禁**

Run:

```bash
npm test
npm run typecheck
npm run test:e2e -- --project=desktop-chromium tests/e2e/income-report-responsive.spec.ts
npm run test:e2e
/opt/miniconda3/bin/python3 -m unittest discover -s /Users/hwang/.codex/skills/income-forecast-2-0/tests -v
python3 /Users/hwang/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/hwang/.codex/skills/income-forecast-2-0
```

Expected: 全部 PASS；控制台无报告脚本错误；360/390/768/1024/1440 全省与武汉页均无整页横向溢出。

- [ ] **Step 6: 提交网站端浏览器门禁**

```bash
git add tests/e2e/income-report-responsive.spec.ts playwright.config.ts
git commit -m "test: lock responsive income reports"
```

若 `playwright.config.ts` 没有实际修改，不把它加入提交。Task 1–3 的 Skill 文件由原计划 Task 14 做主库/移植副本/ZIP 三方清单与 SHA-256 固化。

---

## Self-Review

- 规格覆盖：五档视口、全省/地市、地图、KPI、表格、触控、主题、打印、减少动效、旧报告同步和未来 Skill 兼容均有对应任务。
- 占位扫描：计划不包含 TBD、TODO、“类似 Task N”或未定义接口。
- 类型一致性：UI 版本只由 `create_report.py` 的 `INCOME_REPORT_UI_VERSION` 传入生成器；浏览器暴露常量同名；同步结果字段固定为 `ui_version/styles_sha256/common_sha256`。
- 顺序检查：Task 1–3 在原计划 Task 13 后执行，Task 4 使用同步后的真实报告；原计划 Task 14 最后复制主 Skill、移植副本和 ZIP，不会把旧模板覆盖回来。

## Execution Handoff

用户已选择 Subagent-Driven 并明确要求所有取舍采用推荐方案、一口气完成。因此本计划不再次请求执行方式确认：在原登录项目 Task 13 完成后直接使用 `superpowers:subagent-driven-development`，每个任务由新 implementer 执行并经过独立 review，最后再进入原 Task 14–16。
