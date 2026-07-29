import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import sharp from "sharp";

const expectedTitle = "王昊 · 数据分析、AI 应用与计算数学";
const expectedDescription =
  "王昊的个人作品集：收入预测、数据治理、AI 自动化与计算数学研究。";
const projectURL = "https://hwang0310.dpdns.org/projects/income-forecast/";
const reportDates = ["20", "24", "25", "26"];

test("publishes complete search and social metadata", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(expectedTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    expectedDescription
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    expectedTitle
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    "把复杂问题，做成好用的答案。"
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://hwang0310.dpdns.org/og.png"
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image"
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://hwang0310.dpdns.org/"
  );

  const response = await page.request.get("/og.png");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/png");
  const metadata = await sharp(await response.body()).metadata();
  expect({ width: metadata.width, height: metadata.height }).toEqual({
    width: 1200,
    height: 630,
  });
});

test("desktop portrait narrative and project link work", async (
  { page },
  testInfo
) => {
  test.skip(testInfo.project.name === "pixel-7", "Desktop narrative regression");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("把复杂问题");

  const projectLink = page.getByRole("link", { name: "收入预估 2.0" });
  await expect(projectLink).toHaveAttribute("href", projectURL);
  await page.route(projectURL, async (route) => {
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      path: resolve("dist/projects/income-forecast/index.html"),
    });
  });
  await projectLink.click();

  await expect(page).toHaveURL(/projects\/income-forecast\/$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /选择日期，查看全省及17地市收入预估/,
    })
  ).toBeVisible();
});

test("portrait reveals the real photo accessibly", async ({ page }) => {
  await page.goto("/");

  const toggle = page.locator("[data-portrait-toggle]");
  await expect(toggle).toHaveAccessibleName("查看真实照片");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAccessibleName("查看 AI 肖像");
  const realPortrait = page.locator("[data-portrait-real]");
  await expect(realPortrait).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(() =>
      realPortrait.locator("img").evaluate((element) => {
        const image = element as HTMLImageElement;
        return {
          loaded: image.complete && image.naturalWidth > 0,
          opacity: Number.parseFloat(
            getComputedStyle(image.closest("picture")!).opacity
          ),
        };
      })
    )
    .toEqual({ loaded: true, opacity: 1 });
});

test("report archive and thesis are served from the built site", async (
  { page },
  testInfo
) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "One browser is enough for static asset routing"
  );

  await page.goto("/");
  const thesis = page.getByRole("link", { name: "阅读硕士论文 PDF" });
  await expect(thesis).toHaveAttribute(
    "href",
    "/assets/papers/wang-hao-rkdg-thesis.pdf"
  );

  const paths = [
    "/projects/income-forecast/",
    "/projects/income-forecast/archive-manifest.js",
    "/assets/papers/wang-hao-rkdg-thesis.pdf",
    ...reportDates.map(
      (day) => `/projects/income-forecast/reports/2026/07/${day}/`
    ),
  ];
  for (const path of paths) {
    const response = await page.request.get(path);
    expect(response.ok(), `${path} should be served from dist`).toBe(true);
  }
});

test("mobile menu, thesis link, and layout work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7", "Pixel 7 regression");

  await page.goto("/");
  const menu = page.getByRole("button", { name: "打开主导航" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");

  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("link", { name: "论文" }).click();
  await expect(page).toHaveURL(/#paper$/);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "阅读硕士论文 PDF" })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("core content and static links remain available", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "阅读硕士论文 PDF" })
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "主导航" }).getByRole("link", {
        name: "作品",
      })
    ).toBeVisible();
  });
});

test("reduced-motion preference removes meaningful transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const motion = await page.locator(".button-primary").evaluate((element) => {
    const buttonStyle = getComputedStyle(element);
    return {
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      transitionDurations: buttonStyle.transitionDuration
        .split(",")
        .map((duration) => Number.parseFloat(duration)),
    };
  });

  expect(motion.scrollBehavior).toBe("auto");
  expect(Math.max(...motion.transitionDurations)).toBeLessThanOrEqual(0.001);
});

test("content images declare dimensions, load, and do not overflow", async ({
  page,
}) => {
  await page.goto("/");
  const images = page.locator("main img");
  expect(await images.count()).toBeGreaterThan(0);

  for (let index = 0; index < (await images.count()); index += 1) {
    const image = images.nth(index);
    await expect(image).toHaveAttribute("width", /^[1-9]\d*$/);
    await expect(image).toHaveAttribute("height", /^[1-9]\d*$/);
    const loading = await image.getAttribute("loading");
    const priority = await image.getAttribute("fetchpriority");
    expect(
      loading === "lazy" || priority === "high",
      `image ${index} should declare lazy loading or high fetch priority`
    ).toBe(true);

    if (await image.isVisible()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate((element) => {
            const htmlImage = element as HTMLImageElement;
            return htmlImage.complete && htmlImage.naturalWidth > 0;
          })
        )
        .toBe(true);
    }
  }

  const overflow = await page.evaluate(() => ({
    document:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    images: [...document.querySelectorAll<HTMLElement>("main img")]
      .filter((image) => {
        const style = getComputedStyle(image);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return Math.max(0, rect.right - document.documentElement.clientWidth);
      }),
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(Math.max(0, ...overflow.images)).toBeLessThanOrEqual(1);
});

test("homepage has no serious or critical accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? "")
  );

  expect(severeViolations).toEqual([]);
});
