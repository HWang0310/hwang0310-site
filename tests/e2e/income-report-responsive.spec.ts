import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

const REPORT_PAGES = [
  {
    name: "province",
    path: "/projects/income-forecast/reports/2026/07/25/index.html",
  },
  {
    name: "wuhan",
    path: "/projects/income-forecast/reports/2026/07/25/cities/wuhan.html",
  },
] as const;

async function expectNoPageOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => !element.closest(".table-scroll"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: String(element.className),
          left: rect.left,
          right: rect.right,
        };
      })
      .filter(
        ({ left, right }) =>
          left < -1 || right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 20),
  }));
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.offenders).toEqual([]);
}

test.describe("income report responsive workbench", () => {
  for (const report of REPORT_PAGES) {
    test(`${report.name} report stays usable at every supported viewport`, async ({
      page,
    }) => {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(report.path, { waitUntil: "networkidle" });
        await expect(page.locator("body")).toHaveAttribute(
          "data-report-date",
          "20260725",
        );
        await expectNoPageOverflow(page);

        await expect(page.locator("[data-theme-toggle]")).toBeVisible();
        await expect(page.locator("[data-print]")).toBeVisible();
        await expect(page.locator("[data-archive-year]")).toBeVisible();
        await expect(page.locator("[data-archive-month]")).toBeVisible();
        await expect(page.locator("[data-archive-day]")).toBeVisible();

        const controlHeights = await page.locator(
          "[data-theme-toggle], [data-print], .archive-picker select, .province-back",
        ).evaluateAll((elements) =>
          elements
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            })
            .filter(({ width }) => width > 0),
        );
        expect(controlHeights.length).toBeGreaterThanOrEqual(5);
        expect(Math.min(...controlHeights.map(({ height }) => height))).toBeGreaterThanOrEqual(44);

        const bodyFontSize = await page.locator("body").evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        );
        expect(bodyFontSize).toBeGreaterThanOrEqual(13);

        if (viewport.width <= 390) {
          const tableState = await page.locator(".table-scroll").first().evaluate((element) => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            sticky: getComputedStyle(element.querySelector("th:first-child")!).position,
          }));
          expect(tableState.scrollWidth).toBeGreaterThan(tableState.clientWidth);
          expect(tableState.sticky).toBe("sticky");
        }

        if (report.name === "province") {
          await expect(page.locator("#province-map")).toBeVisible();
          await expect(page.locator(".metric-card")).toHaveCount(4);
        } else {
          await expect(page.locator(".province-back")).toBeVisible();
          await expect(page.locator(".city-nav")).toBeVisible();
          await expect(page.locator(".compare-bars")).toBeVisible();
        }
      }
    });
  }

  test("reduced motion and print styles preserve report content", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(REPORT_PAGES[0].path, { waitUntil: "networkidle" });
    await expect(page.locator(".table-scroll").first()).toBeVisible();
    await expect
      .poll(() => page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior))
      .toBe("auto");

    await page.emulateMedia({ media: "print" });
    const printState = await page.locator(".table-scroll").first().evaluate((element) => ({
      overflow: getComputedStyle(element).overflowX,
      sticky: getComputedStyle(element.querySelector("th:first-child")!).position,
    }));
    expect(printState.overflow).toBe("visible");
    expect(printState.sticky).toBe("static");
  });
});
