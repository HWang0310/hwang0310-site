# 王昊个人网站首页升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `hwang0310.dpdns.org` 首页升级为“滚动肖像＋小狗向导”的轻量个人作品集，同时完整保留收入预估入口、已发布历史报告和固定路径。

**Architecture:** 使用 Vite、TypeScript、语义化 HTML 和分层 CSS 构建单页静态网站；HTML 直接包含全部核心内容，TypeScript 仅渐进增强滚动章节、肖像切换、导航和小狗状态。构建结束后由独立脚本把论文 PDF 和本地收入预估归档安全装配进同一 `dist/`，先发布 Cloudflare Pages 预览分支，验证通过后再发布 `main`。

**Tech Stack:** Node.js 22+、npm、Vite、TypeScript、原生 HTML/CSS、Vitest + jsdom、Playwright、Sharp、Cloudflare Pages/Wrangler。

**Approved Design:** `docs/superpowers/specs/2026-07-29-homepage-redesign-design.md`。

## Global Constraints

- 正式姓名显示为“王昊”，英文标识为“Hwang”。
- 首屏标题固定为“把复杂问题，做成好用的答案。”
- 不实现 3D、GLB、WebGL、视频背景、声音、登录、评论、CMS、博客或联系表单。
- 不公开手机号 `18062752550`；公开邮箱仅为 `hwang0310@163.com`。
- 保留 `https://hwang0310.dpdns.org/projects/income-forecast/`。
- 保留已发布报告日期 `20260720`、`20260724`、`20260725`、`20260726` 及其全部子资源。
- 原硕士论文 PDF 公开发布，不删除封面学号和声明页。
- JavaScript 失效时，正文、项目链接、论文链接和联系方式仍须可用。
- 支持鼠标、触摸、键盘和 `prefers-reduced-motion`。
- 仅预加载首屏肖像；其余图片延迟加载。
- 构建和预览验证完成前，不得部署到 Cloudflare Pages 生产分支。
- 每个任务遵循 RED → GREEN → REFACTOR，并独立提交。

---

## File Structure

### 项目与配置

- `package.json`：开发、测试、构建、预览和装配脚本。
- `package-lock.json`：锁定依赖。
- `tsconfig.json`：浏览器 TypeScript 配置。
- `vite.config.ts`：Vite 根页面与测试环境配置。
- `vitest.config.ts`：jsdom 单元测试配置。
- `playwright.config.ts`：桌面和手机端到端验证。
- `.gitignore`：忽略依赖、构建物、临时归档和本地素材配置。

### 页面

- `index.html`：语义化首页、全部可降级内容和元数据。
- `src/main.ts`：渐进增强入口和模块编排。
- `src/site-content.ts`：交互需要的章节 ID、肖像状态和小狗姿态类型。
- `src/scroll-chapters.ts`：章节观察与当前章节状态。
- `src/portrait-flip.ts`：AI 肖像/真实照片切换。
- `src/dog-guide.ts`：小狗姿态和章节跳转。
- `src/site-nav.ts`：移动端菜单和锚点关闭行为。

### 样式

- `src/styles/tokens.css`：颜色、字号、间距、阴影和动效时长。
- `src/styles/base.css`：重置、排版、焦点和基础语义元素。
- `src/styles/layout.css`：桌面双栏、章节、平板和手机布局。
- `src/styles/components.css`：导航、肖像、项目卡、时间线、小狗和页尾。
- `src/styles/motion.css`：章节过渡、视差、翻转和减少动态效果。

### 素材与归档

- `artwork/source/dog-guide-master.png`：四个动作的高分辨率小狗主图。
- `public/images/`：压缩后的肖像、小狗和分享图。
- `public/projects/income-forecast/index.html`：收入预估归档入口。
- `data/report-archive.json`：生产报告日期和本地目录映射。
- `scripts/prepare-assets.mjs`：肖像、真实照片和小狗切图/压缩。
- `scripts/stage-static-assets.mjs`：论文、报告归档和 manifest 装配。
- `dist/`：最终 Cloudflare Pages 发布目录，不提交 Git。

### 测试

- `tests/content-contract.test.ts`：姓名、章节、链接、指标和隐私契约。
- `tests/scroll-chapters.test.ts`：章节状态和清理。
- `tests/portrait-flip.test.ts`：点击与键盘切换。
- `tests/dog-guide.test.ts`：姿态和章节跳转。
- `tests/asset-pipeline.test.ts`：图片变体和透明小狗切图。
- `tests/static-staging.test.ts`：报告与论文装配。
- `tests/e2e/homepage.spec.ts`：桌面、手机、减少动态效果和关键链接。

---

### Task 1: 建立轻量静态应用与内容契约

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `tests/content-contract.test.ts`

**Interfaces:**
- Produces: `index.html` 中的 `#about`、`#work`、`#paper`、`#journey`、`#contact`。
- Produces: `src/main.ts` 的 `bootstrap(root: Document): () => void`。
- Consumes: 无。

- [ ] **Step 1: 安装项目依赖并生成锁文件**

Run:

```bash
cd /Users/hwang/Movies/Codex工作空间/hwang0310-site
npm init -y
npm install -D vite typescript vitest jsdom @types/node sharp @playwright/test @axe-core/playwright
```

修改 `package.json`，固定脚本：

```json
{
  "name": "hwang0310-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "vite build",
    "preview": "vite preview",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 2: 写内容契约失败测试**

`tests/content-contract.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve("index.html"), "utf8");
const document = new JSDOM(html).window.document;

describe("homepage content contract", () => {
  it("publishes the approved identity and sections", () => {
    expect(document.querySelector("h1")?.textContent).toContain("把复杂问题");
    expect(document.body.textContent).toContain("王昊");
    for (const id of ["about", "work", "paper", "journey", "contact"]) {
      expect(document.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("preserves public links and excludes the phone number", () => {
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.href);
    expect(hrefs).toContain("https://hwang0310.dpdns.org/projects/income-forecast/");
    expect(hrefs).toContain("https://github.com/HWang0310");
    expect(html).not.toContain("18062752550");
  });
});
```

- [ ] **Step 3: 运行测试确认 RED**

Run:

```bash
npm test -- tests/content-contract.test.ts
```

Expected: FAIL，因为 `index.html` 尚未包含批准的章节和链接。

- [ ] **Step 4: 创建最小语义化首页和启动入口**

`index.html` 必须直接包含全部五个章节；不使用 JavaScript 生成正文。最小骨架：

```html
<main>
  <section id="hero" data-chapter="hero">
    <p>数据分析师 · AI 应用创造者</p>
    <h1>把复杂问题，做成好用的答案。</h1>
  </section>
  <section id="about" data-chapter="about"><h2>认识一下王昊</h2></section>
  <section id="work" data-chapter="work"><h2>收入预估 2.0</h2></section>
  <section id="paper" data-chapter="paper"><h2>学术研究</h2></section>
  <section id="journey" data-chapter="journey"><h2>经历与方法</h2></section>
  <section id="contact" data-chapter="contact"><h2>联系王昊</h2></section>
</main>
<script type="module" src="/src/main.ts"></script>
```

`src/main.ts`：

```ts
export function bootstrap(root: Document): () => void {
  root.documentElement.dataset.enhanced = "true";
  return () => delete root.documentElement.dataset.enhanced;
}

if (typeof document !== "undefined") bootstrap(document);
```

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```bash
npm test -- tests/content-contract.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交基础应用**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts .gitignore index.html src/main.ts tests/content-contract.test.ts
git commit -m "feat: scaffold accessible personal homepage"
```

---

### Task 2: 生成并处理肖像与小狗素材

**Files:**
- Create: `artwork/source/dog-guide-master.png`
- Create: `scripts/prepare-assets.mjs`
- Create: `tests/asset-pipeline.test.ts`
- Create: `public/images/portrait-sage.webp`
- Create: `public/images/portrait-sage.avif`
- Create: `public/images/portrait-sage.jpg`
- Create: `public/images/portrait-warm.webp`
- Create: `public/images/portrait-warm.avif`
- Create: `public/images/portrait-warm.jpg`
- Create: `public/images/portrait-mobile.webp`
- Create: `public/images/portrait-mobile.jpg`
- Create: `public/images/portrait-real.webp`
- Create: `public/images/portrait-real.jpg`
- Create: `public/images/dog-inspect.webp`
- Create: `public/images/dog-point.webp`
- Create: `public/images/dog-run.webp`
- Create: `public/images/dog-rest.webp`

**Interfaces:**
- Produces: `prepareAssets(options): Promise<string[]>`，其中 `options` 含六个源文件路径和一个输出目录。
- Produces: 四个固定小狗姿态名 `inspect | point | run | rest`。
- Consumes: 用户提供的三张 AI 肖像、`/Users/hwang/Pictures/IMG_7447.JPG`。

- [ ] **Step 1: 检查四个源文件仍可读取**

Run:

```bash
test -f '/var/folders/8s/_lxwv_9d2x3b0y2wwq2qjrp00000gn/T/codex-clipboard-c5efc6d7-a6fe-4325-9192-66fbfcf68144.png'
test -f '/var/folders/8s/_lxwv_9d2x3b0y2wwq2qjrp00000gn/T/codex-clipboard-8e89fb7a-75b8-46e9-bd5e-e810d38e4e72.png'
test -f '/var/folders/8s/_lxwv_9d2x3b0y2wwq2qjrp00000gn/T/codex-clipboard-a83c2fc7-5a89-4d85-b6d6-81926a98a465.png'
test -f '/Users/hwang/Pictures/IMG_7447.JPG'
```

Expected: 四条命令退出码均为 0。若任一临时肖像已消失，停止本任务并请用户重新附上对应图片；不得用真实照片或另一张肖像静默替代。

- [ ] **Step 2: 使用 GPT-image2 图像生成创建小狗主图**

以用户最初提供的暖黄色卡通狗参考风格和已批准简报生成一张横向四格角色主图：

```text
原创暖黄色垂耳幼犬网站向导，蓝绿色项圈，炭黑手绘轮廓，
低饱和奶油色填充，轻微不规则线条，温和亲切但不过度幼化。
透明背景，横向四个等宽独立动作格，角色互不重叠：
1 拿放大镜检查数据；2 向右前方指路；3 沿手绘路线小跑；
4 蜷卧休息。四格保持完全一致的头身比例、面部特征、项圈颜色和线条粗细。
无文字、无标签、无水印、无多余物体。
```

保存为 `artwork/source/dog-guide-master.png`。检查四格是否完整、无肢体融合、无文字；不可用时仅重试一次。

- [ ] **Step 3: 写素材处理失败测试**

`tests/asset-pipeline.test.ts` 使用 Sharp 创建 400×100 的透明四格测试图和 100×160 肖像，调用 `prepareAssets()` 后断言：

```ts
expect(outputs).toEqual(expect.arrayContaining([
  "portrait-sage.webp",
  "portrait-sage.avif",
  "portrait-sage.jpg",
  "dog-inspect.webp",
  "dog-point.webp",
  "dog-run.webp",
  "dog-rest.webp",
]));
```

- [ ] **Step 4: 运行测试确认 RED**

```bash
npm test -- tests/asset-pipeline.test.ts
```

Expected: FAIL，`prepareAssets` 尚未定义。

- [ ] **Step 5: 实现图片变体和四格切图**

`scripts/prepare-assets.mjs` 导出：

```js
/**
 * @typedef {Object} AssetOptions
 * @property {string} portraitSage
 * @property {string} portraitWarm
 * @property {string} portraitMobile
 * @property {string} portraitReal
 * @property {string} dogSheet
 * @property {string} outDir
 */

/** @param {AssetOptions} options */
export async function prepareAssets({
  portraitSage,
  portraitWarm,
  portraitMobile,
  portraitReal,
  dogSheet,
  outDir,
}) {
  // portrait: autoOrient → resize → webp/avif/jpeg fallback
  // dogSheet: read width, divide into four equal cells, trim transparent edges,
  // resize to fit within 320×320, and write four transparent WebP files.
  return writtenBasenames;
}
```

生产执行参数固定为：

```bash
node scripts/prepare-assets.mjs \
  --portrait-sage '/var/folders/8s/_lxwv_9d2x3b0y2wwq2qjrp00000gn/T/codex-clipboard-c5efc6d7-a6fe-4325-9192-66fbfcf68144.png' \
  --portrait-warm '/var/folders/8s/_lxwv_9d2x3b0y2wwq2qjrp00000gn/T/codex-clipboard-8e89fb7a-75b8-46e9-bd5e-e810d38e4e72.png' \
  --portrait-mobile '/var/folders/8s/_lxwv_9d2x3b0y2wwq2qjrp00000gn/T/codex-clipboard-a83c2fc7-5a89-4d85-b6d6-81926a98a465.png' \
  --portrait-real '/Users/hwang/Pictures/IMG_7447.JPG' \
  --dog-sheet 'artwork/source/dog-guide-master.png' \
  --out-dir 'public/images'
```

- [ ] **Step 6: 运行测试并检查生成图片**

```bash
npm test -- tests/asset-pipeline.test.ts
```

Expected: PASS。随后逐张检查 `public/images/` 中的肖像和四个小狗动作，确认没有拉伸、裁头、白边或透明通道丢失。

- [ ] **Step 7: 提交素材管线与经检查的网页素材**

```bash
git add artwork/source/dog-guide-master.png scripts/prepare-assets.mjs tests/asset-pipeline.test.ts public/images
git commit -m "feat: add portrait and dog guide assets"
```

---

### Task 3: 完成视觉系统与静态内容

**Files:**
- Modify: `index.html`
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/layout.css`
- Create: `src/styles/components.css`
- Create: `src/styles/motion.css`
- Modify: `src/main.ts`
- Modify: `tests/content-contract.test.ts`

**Interfaces:**
- Produces: `[data-portrait-stage]`、`[data-portrait-sage]`、`[data-portrait-warm]`。
- Produces: `[data-dog-guide]`、`[data-dog-pose]`。
- Produces: 所有章节的静态正文和可用链接。
- Consumes: Task 2 的图片资产。

- [ ] **Step 1: 扩展内容契约失败测试**

增加断言：

```ts
expect(document.body.textContent).toContain("17 个地市");
expect(document.body.textContent).toContain("18 类业务");
expect(document.body.textContent).toContain("3.20%");
expect(document.body.textContent).toContain("基于三角函数基 RKDG 方法的误差分析");
expect(document.body.textContent).toContain("报告自动化工作流");
expect(document.body.textContent).toContain("北京大学重庆大数据研究院");
expect(document.querySelector("[data-portrait-stage]")).not.toBeNull();
expect(document.querySelector("[data-dog-guide]")).not.toBeNull();
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npm test -- tests/content-contract.test.ts
```

Expected: FAIL，页面尚未包含完整内容和视觉挂点。

- [ ] **Step 3: 写完整静态 HTML**

`index.html` 必须包含：

- `王昊 · Hwang` 顶部品牌。
- 关于、作品、论文、经历、联系导航。
- 17 地市、18 类业务、289/255 键、54 个模拟预测日、3.20% WMAPE、0.45% 合计偏差、30/20/50 分钟和人工 5–10 分钟。
- GitHub、`mailto:hwang0310@163.com`、收入预估、论文链接。
- AI 肖像/真实照片按钮和小狗按钮的可访问标签。
- `#work` 内独立的 `[data-project="ai-automation"]` 工作流卡片。
- 2016–2020、2020–2023、2022、2022–2023、2023–至今五段经历。
- `aria-hidden="true"` 的星星、箭头、粉笔线和脚印装饰挂点。

肖像图片使用 `<picture>`，依次提供 AVIF、WebP 和 JPEG 回退，并写明宽高属性。`portrait-sage` 是唯一使用 `<link rel="preload" as="image">` 的图片；真实照片和后续图片添加 `loading="lazy"`。

- [ ] **Step 4: 写分层 CSS**

关键变量固定为：

```css
:root {
  --color-ink: #273029;
  --color-cream: #fffdf6;
  --color-paper: #f5eedf;
  --color-sage: #b8d7ac;
  --color-apricot: #f1bd75;
  --color-bluegreen: #6eaaa4;
  --content-max: 1180px;
  --radius-card: 22px;
}
```

桌面端 `min-width: 960px` 使用左右双栏；手机端恢复单栏。`main` 中的文字在没有 `.enhanced` 状态时全部可见。

标题字体固定使用 `Songti SC, STSong, serif`，正文使用 `-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`，手写注释使用 `Kaiti SC, STKaiti, cursive`。所有交互目标最小 44×44 像素，正文颜色组合达到 WCAG AA。

- [ ] **Step 5: 在入口导入 CSS**

`src/main.ts`：

```ts
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/motion.css";
```

- [ ] **Step 6: 运行内容测试和生产构建**

```bash
npm test -- tests/content-contract.test.ts
npm run build
```

Expected: 内容测试 PASS，Vite 构建 PASS；此时构建只生成首页，论文与报告在 Task 7 接入。

- [ ] **Step 7: 提交页面视觉与正文**

```bash
git add index.html src/main.ts src/styles tests/content-contract.test.ts
git commit -m "feat: build portrait-led portfolio content"
```

---

### Task 4: 实现滚动章节和肖像过渡

**Files:**
- Create: `src/site-content.ts`
- Create: `src/scroll-chapters.ts`
- Create: `tests/scroll-chapters.test.ts`
- Modify: `src/main.ts`
- Modify: `src/styles/motion.css`

**Interfaces:**
- Produces: `type ChapterId = "hero" | "about" | "work" | "paper" | "journey" | "contact"`。
- Produces: `initScrollChapters(options): () => void`。
- Consumes: `section[data-chapter]`。
- Calls: `onChange(chapter: ChapterId)`。

- [ ] **Step 1: 写章节观察失败测试**

测试使用可控的假 `IntersectionObserver`，验证：

```ts
const cleanup = initScrollChapters({
  root: document,
  createObserver: fakeFactory,
  onChange: (chapter) => changes.push(chapter),
});

fakeFactory.emit("work", 0.78);
expect(changes.at(-1)).toBe("work");
cleanup();
expect(fakeFactory.disconnected).toBe(true);
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npm test -- tests/scroll-chapters.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现章节观察器**

`src/site-content.ts`：

```ts
export type ChapterId =
  | "hero"
  | "about"
  | "work"
  | "paper"
  | "journey"
  | "contact";
```

`src/scroll-chapters.ts`：

```ts
import type { ChapterId } from "./site-content";

type ChapterObserver = {
  observe(element: Element): void;
  disconnect(): void;
};

export interface ScrollChapterOptions {
  root: Document;
  createObserver?: (
    callback: IntersectionObserverCallback,
  ) => ChapterObserver;
  onChange(chapter: ChapterId): void;
}

export function initScrollChapters({
  root,
  createObserver = (callback) => new IntersectionObserver(callback, {
    rootMargin: "-25% 0px -45% 0px",
    threshold: [0, 0.25, 0.5, 0.75, 1],
  }),
  onChange,
}: ScrollChapterOptions): () => void {
  // 选择 section[data-chapter]，以最高 intersectionRatio 决定当前章节；
  // 相同 ratio 时保持当前章节，避免来回闪烁。
}
```

- [ ] **Step 4: 将章节状态连接到页面**

`src/main.ts` 在 `onChange` 中更新：

```ts
document.documentElement.dataset.activeChapter = chapter;
portraitStage.dataset.state = chapter === "hero" || chapter === "about"
  ? "sage"
  : "warm";
```

- [ ] **Step 5: 实现交叉淡化和轻微视差**

仅动画 `opacity` 和 `transform`。鼠尾草肖像在 `sage` 为 1，杏黄色肖像在 `warm` 为 1；持续时间使用 `--motion-slow: 700ms`。`[data-doodle]` 只做不超过 12px 的分层位移，并且永不覆盖正文。

- [ ] **Step 6: 运行测试和构建**

```bash
npm test -- tests/scroll-chapters.test.ts
npm run build
```

Expected: PASS。

- [ ] **Step 7: 提交滚动叙事**

```bash
git add src/site-content.ts src/scroll-chapters.ts src/main.ts src/styles/motion.css tests/scroll-chapters.test.ts
git commit -m "feat: add scroll-driven portrait narrative"
```

---

### Task 5: 实现照片翻转和响应式导航

**Files:**
- Create: `src/portrait-flip.ts`
- Create: `src/site-nav.ts`
- Create: `tests/portrait-flip.test.ts`
- Modify: `src/main.ts`
- Modify: `src/styles/components.css`
- Modify: `src/styles/motion.css`

**Interfaces:**
- Produces: `initPortraitFlip(root: Document): () => void`。
- Produces: `initSiteNav(root: Document): () => void`。
- Consumes: `[data-portrait-toggle]`、`[data-about-portrait]`、`[data-nav-toggle]`、`[data-site-nav]`。

- [ ] **Step 1: 写照片翻转失败测试**

```ts
button.click();
expect(button.getAttribute("aria-pressed")).toBe("true");
expect(card.dataset.face).toBe("real");

button.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
expect(card.dataset.face).toBe("ai");
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npm test -- tests/portrait-flip.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现可访问照片切换**

`initPortraitFlip` 必须：

- 点击切换 `data-face="ai|real"`。
- 同步 `aria-pressed` 和按钮文本。
- Enter/Space 可操作，Space 阻止页面滚动。
- cleanup 移除所有监听器。

- [ ] **Step 4: 实现手机菜单**

`initSiteNav` 必须：

- 切换 `aria-expanded` 和 `[data-open]`。
- 点击任一锚点后关闭菜单。
- Escape 关闭并把焦点还给菜单按钮。
- 宽屏布局不依赖 JavaScript 才可见。

- [ ] **Step 5: 写减少动态效果样式**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6: 运行单元测试与构建**

```bash
npm test -- tests/portrait-flip.test.ts
npm run build
```

Expected: PASS。

- [ ] **Step 7: 提交照片和导航交互**

```bash
git add src/portrait-flip.ts src/site-nav.ts src/main.ts src/styles/components.css src/styles/motion.css tests/portrait-flip.test.ts
git commit -m "feat: add accessible portrait and navigation controls"
```

---

### Task 6: 实现小狗章节向导

**Files:**
- Create: `src/dog-guide.ts`
- Create: `tests/dog-guide.test.ts`
- Modify: `src/site-content.ts`
- Modify: `src/main.ts`
- Modify: `index.html`
- Modify: `src/styles/components.css`
- Modify: `src/styles/motion.css`

**Interfaces:**
- Produces: `type DogPose = "inspect" | "point" | "run" | "rest"`。
- Produces: `setDogPose(element: HTMLImageElement, pose: DogPose): void`。
- Produces: `initDogGuide(root: Document): () => void`。
- Consumes: Task 2 的 `/images/dog-inspect.webp`、`dog-point.webp`、`dog-run.webp`、`dog-rest.webp`。
- Consumes: Task 4 的 `ChapterId`。

- [ ] **Step 1: 写姿态映射失败测试**

```ts
expect(dogPoseForChapter("work")).toBe("inspect");
expect(dogPoseForChapter("paper")).toBe("point");
expect(dogPoseForChapter("journey")).toBe("run");
expect(dogPoseForChapter("contact")).toBe("rest");
```

并验证 `setDogPose()` 同步 `src`、`alt` 和 `data-pose`。

- [ ] **Step 2: 运行测试确认 RED**

```bash
npm test -- tests/dog-guide.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现小狗状态**

`src/dog-guide.ts`：

```ts
const poseByChapter: Record<ChapterId, DogPose> = {
  hero: "point",
  about: "point",
  work: "inspect",
  paper: "point",
  journey: "run",
  contact: "rest",
};
```

`setDogPose()` 使用预加载后的图片地址；未加载成功时保持上一姿态，不隐藏章节内容。

- [ ] **Step 4: 实现小狗按钮行为**

- hero/about：跳到 `#work`。
- work：聚焦收入预估项目链接。
- paper：聚焦论文链接。
- journey：跳到下一经历节点。
- contact：返回顶部。

按钮文本通过 `aria-label` 说明当前行为。

- [ ] **Step 5: 将小狗与章节状态连接**

Task 4 的 `onChange` 同时调用：

```ts
setDogPose(dogElement, dogPoseForChapter(chapter));
```

移动端禁用横向位移动画，只在章节标题附近显示对应姿态。

- [ ] **Step 6: 运行测试和构建**

```bash
npm test -- tests/dog-guide.test.ts
npm run build
```

Expected: PASS。

- [ ] **Step 7: 提交小狗向导**

```bash
git add src/dog-guide.ts src/site-content.ts src/main.ts index.html src/styles/components.css src/styles/motion.css tests/dog-guide.test.ts
git commit -m "feat: add dog guide chapter interactions"
```

---

### Task 7: 安全装配收入报告和硕士论文

**Files:**
- Create: `data/report-archive.json`
- Create: `public/projects/income-forecast/index.html`
- Create: `scripts/stage-static-assets.mjs`
- Create: `tests/static-staging.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `index.html`

**Interfaces:**
- Produces: `stageStaticAssets(options): Promise<{files: number; dates: string[]}>`。
- Produces: `dist/projects/income-forecast/archive-manifest.js`。
- Produces: `dist/projects/income-forecast/reports/YYYY/MM/DD/**`。
- Produces: `dist/assets/papers/wang-hao-rkdg-thesis.pdf`。
- Consumes: `/Users/hwang/Music/收入预估/收入预估2026/收入预估202607/`。
- Consumes: `/Users/hwang/Pictures/厦大毕业相关/厦大毕业论文（终版）-王昊.pdf`。

- [ ] **Step 1: 固定生产归档清单**

`data/report-archive.json`：

```json
[
  {"date":"20260720","folder":"收入预估报告-20260720-html"},
  {"date":"20260724","folder":"收入预估报告-20260724-html"},
  {"date":"20260725","folder":"收入预估报告-20260725-html"},
  {"date":"20260726","folder":"收入预估报告-20260726-html"}
]
```

- [ ] **Step 2: 写装配失败测试**

在临时目录创建两份报告 fixture、入口和 PDF，调用 `stageStaticAssets()` 后断言：

```ts
expect(existsSync(resolve(dist, "projects/income-forecast/reports/2026/07/20/index.html"))).toBe(true);
expect(existsSync(resolve(dist, "assets/papers/wang-hao-rkdg-thesis.pdf"))).toBe(true);
expect(readFileSync(manifest, "utf8")).not.toContain("file:///Users/");
```

再增加缺少 `cities/` 或 `assets/` 时拒绝装配的测试。

- [ ] **Step 3: 运行测试确认 RED**

```bash
npm test -- tests/static-staging.test.ts
```

Expected: FAIL。

- [ ] **Step 4: 实现装配脚本**

`stageStaticAssets()` 接收 `{ archiveFile, reportRoot, thesisFile, distDir }`，必须：

1. 验证每个源报告包含 `index.html`、`cities/` 和 `assets/`。
2. 按日期复制到 `dist/projects/income-forecast/reports/YYYY/MM/DD/`。
3. 生成只含 `date` 和 `webPath` 的 `archive-manifest.js`，不得包含本地路径。
4. 复制论文到 `dist/assets/papers/wang-hao-rkdg-thesis.pdf`。
5. 任一验证失败时退出非零，且不调用 Wrangler。

同时把 `package.json` 的构建脚本改为：

```json
"build": "vite build && node scripts/stage-static-assets.mjs"
```

- [ ] **Step 5: 保存收入预估入口**

以当前线上入口为基准创建 `public/projects/income-forecast/index.html`，保留年份、月份、日期选择器和最新报告按钮；只修改“返回个人主页”的视觉以匹配新首页，不改变归档行为。

- [ ] **Step 6: 将论文和归档链接接入首页**

论文链接固定为：

```html
<a href="/assets/papers/wang-hao-rkdg-thesis.pdf"
   target="_blank"
   rel="noopener">阅读硕士论文 PDF</a>
```

- [ ] **Step 7: 运行测试与完整构建**

```bash
npm test -- tests/static-staging.test.ts
npm run build
```

Expected: PASS，且 `dist/` 包含四个日期、论文和首页。

- [ ] **Step 8: 提交静态装配**

```bash
git add data/report-archive.json public/projects/income-forecast/index.html scripts/stage-static-assets.mjs tests/static-staging.test.ts package.json .gitignore index.html
git commit -m "feat: preserve reports and publish thesis asset"
```

---

### Task 8: 完成搜索、分享与端到端验证

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/homepage.spec.ts`
- Create: `scripts/create-og-image.mjs`
- Create: `public/og.png`
- Modify: `index.html`
- Modify: `package.json`

**Interfaces:**
- Produces: 可由 `npm run test:e2e` 验证的站点。
- Consumes: 所有前置任务。

- [ ] **Step 1: 写桌面与手机端失败测试**

`tests/e2e/homepage.spec.ts`：

```ts
import { expect, test } from "@playwright/test";

test("desktop portrait narrative and links work", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("把复杂问题");
  await page.getByRole("link", { name: "收入预估 2.0" }).click();
  await expect(page).toHaveURL(/projects\/income-forecast/);
});

test("portrait can reveal the real photo", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "查看真实照片" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});
```

增加手机 viewport 测试，验证菜单、无横向滚动和论文链接。

再增加两项回归：

```ts
test("core content works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "阅读硕士论文 PDF" })).toBeVisible();
  await context.close();
});
```

使用 `@axe-core/playwright` 检查首页没有 critical 或 serious 级无障碍问题，并验证所有带尺寸的内容图片未造成布局溢出。

- [ ] **Step 2: 运行端到端测试确认 RED**

```bash
npm run build
npm run test:e2e
```

Expected: FAIL，Playwright 配置、元数据或交互尚未完整。

- [ ] **Step 3: 配置 Playwright**

安装本地 Chromium：

```bash
npx playwright install chromium webkit
```

`playwright.config.ts` 使用 `npm run build && npm run preview -- --host 127.0.0.1`，配置 Chromium 桌面、WebKit 桌面和 Pixel 7 三个项目；WebKit 负责 Safari 引擎回归。若 `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` 存在，则配置 `channel: "msedge"` 的第四个桌面项目；否则在发布记录中明确标注 Edge 未安装，而 Chromium 回归已通过。所有测试都针对已装配论文和报告的 `dist/`，不依赖外部生产站点。

- [ ] **Step 4: 生成专属分享图**

创建 `scripts/create-og-image.mjs`，使用 Sharp 将 `portrait-sage.webp`、`dog-point.webp` 和确定性的文字图层合成为 1200×630 PNG。画面必须包含：

- `王昊 · Hwang`
- `数据分析、AI 应用与计算数学`
- 鼠尾草绿、奶油白和杏黄色
- 小狗头像标记

脚本文字固定使用 `PingFang SC, Hiragino Sans GB, sans-serif`；生成后检查文字、人物和小狗均未裁切，保存为 `public/og.png`。

- [ ] **Step 5: 补齐元数据**

`index.html` 加入：

```html
<title>王昊 · 数据分析、AI 应用与计算数学</title>
<meta name="description" content="王昊的个人作品集：收入预测、数据治理、AI 自动化与计算数学研究。">
<meta property="og:title" content="王昊 · 数据分析、AI 应用与计算数学">
<meta property="og:description" content="把复杂问题，做成好用的答案。">
<meta property="og:image" content="https://hwang0310.dpdns.org/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://hwang0310.dpdns.org/">
```

- [ ] **Step 6: 运行全部验证**

```bash
npm test
npm run build
npm run test:e2e
```

Expected: 全部 PASS。

- [ ] **Step 7: 检查构建产物契约**

Run:

```bash
test -f dist/index.html
test -f dist/og.png
test -f dist/assets/papers/wang-hao-rkdg-thesis.pdf
test -f dist/projects/income-forecast/archive-manifest.js
test -f dist/projects/income-forecast/reports/2026/07/26/index.html
! rg -n '18062752550|file:///Users/' dist
```

Expected: 所有 `test` 成功，`rg` 无匹配。

- [ ] **Step 8: 提交搜索与验证**

```bash
git add playwright.config.ts tests/e2e/homepage.spec.ts scripts/create-og-image.mjs public/og.png index.html package.json
git commit -m "test: verify responsive homepage experience"
```

---

### Task 9: Cloudflare Pages 预览、生产发布与回归

**Files:**
- Create: `docs/releases/2026-07-29-homepage-redesign.md`

**Interfaces:**
- Produces: `hwang0310-site` 的已验证生产部署。
- Consumes: Task 8 的完整 `dist/`。

- [ ] **Step 1: 记录当前 Cloudflare 部署**

Run:

```bash
wrangler pages project list
wrangler pages deployment list --project-name hwang0310-site
```

Expected: 账户 `bd8ad6d1ec4ff38ac655e8f60a336b53` 下存在唯一 Pages 项目 `hwang0310-site`。若网络或授权失败，停止发布并保留已通过的本地构建。

- [ ] **Step 2: 重新运行发布前验证**

```bash
npm test
npm run build
npm run test:e2e
```

Expected: 全部 PASS，且 Git 工作树仅允许新增的发布记录未提交。

- [ ] **Step 3: 发布非生产预览分支**

将部署输出保存并提取返回的 `pages.dev` 预览 URL：

```bash
wrangler pages deploy dist \
  --project-name hwang0310-site \
  --branch homepage-redesign-preview \
  | tee /tmp/hwang0310-pages-preview.txt
SITE_PREVIEW_URL="$(rg -o 'https://[a-zA-Z0-9.-]+\.pages\.dev' /tmp/hwang0310-pages-preview.txt | tail -n 1)"
test -n "$SITE_PREVIEW_URL"
printf '%s\n' "$SITE_PREVIEW_URL" > /tmp/hwang0310-pages-preview-url.txt
```

- [ ] **Step 4: 验证预览 URL**

对预览 URL 验证：

```bash
SITE_PREVIEW_URL="$(tail -n 1 /tmp/hwang0310-pages-preview-url.txt)"
test -n "$SITE_PREVIEW_URL"
curl -fsS "$SITE_PREVIEW_URL/" | rg '把复杂问题'
curl -fsSI "$SITE_PREVIEW_URL/assets/papers/wang-hao-rkdg-thesis.pdf"
curl -fsSI "$SITE_PREVIEW_URL/projects/income-forecast/"
curl -fsSI "$SITE_PREVIEW_URL/projects/income-forecast/reports/2026/07/20/"
curl -fsSI "$SITE_PREVIEW_URL/projects/income-forecast/reports/2026/07/24/"
curl -fsSI "$SITE_PREVIEW_URL/projects/income-forecast/reports/2026/07/25/"
curl -fsSI "$SITE_PREVIEW_URL/projects/income-forecast/reports/2026/07/26/"
```

Expected: 首页包含标题，所有资源返回 200。

- [ ] **Step 5: 发布生产分支**

仅在 Step 4 全部成功后执行：

```bash
wrangler pages deploy dist \
  --project-name hwang0310-site \
  --branch main
```

- [ ] **Step 6: 验证自定义域名和历史路径**

```bash
curl -fsS 'https://hwang0310.dpdns.org/' | rg '王昊|把复杂问题'
curl -fsSI 'https://hwang0310.dpdns.org/assets/papers/wang-hao-rkdg-thesis.pdf'
curl -fsSI 'https://hwang0310.dpdns.org/projects/income-forecast/'
curl -fsSI 'https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/26/cities/wuhan.html'
```

Expected: 全部成功，收入预估历史路径未回归。

- [ ] **Step 7: 写发布记录**

`docs/releases/2026-07-29-homepage-redesign.md` 记录：

- 发布日期和生产 URL。
- 预览与生产部署均成功。
- 单元测试、构建和 Playwright 结果。
- 已验证的四个报告日期、论文 PDF、GitHub 和邮箱。
- Cloudflare 部署列表中可用于回滚的上一生产部署标识。

- [ ] **Step 8: 提交发布记录**

```bash
git add docs/releases/2026-07-29-homepage-redesign.md
git commit -m "docs: record homepage production release"
```

---

## Final Verification

完成全部任务后再次执行：

```bash
git status --short
npm test
npm run build
npm run test:e2e
curl -fsS 'https://hwang0310.dpdns.org/' | rg '把复杂问题'
curl -fsSI 'https://hwang0310.dpdns.org/projects/income-forecast/reports/2026/07/26/'
curl -fsSI 'https://hwang0310.dpdns.org/assets/papers/wang-hao-rkdg-thesis.pdf'
```

预期结果：

- Git 工作树干净。
- 所有单元和端到端测试通过。
- 构建成功。
- 生产首页、收入报告和论文均可访问。
- 生产页面不含手机号或本地 `file:///Users/` 路径。
