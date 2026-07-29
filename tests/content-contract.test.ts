import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve("index.html"), "utf8");
const document = new JSDOM(html).window.document;
const releaseNote = readFileSync(
  resolve("docs/releases/2026-07-29-homepage-redesign.md"),
  "utf8"
);

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

  it("keeps the shareable release note free of the private phone literal", () => {
    expect(releaseNote).not.toContain("18062752550");
    expect(releaseNote).toContain("私人手机号");
  });

  it("uses the existing dog artwork as the decorative brand avatar", () => {
    const avatar = document.querySelector<HTMLImageElement>(".brand-mark");

    expect(avatar?.getAttribute("src")).toBe("/images/dog-point.webp");
    expect(avatar?.getAttribute("alt")).toBe("");
    expect(avatar?.getAttribute("width")).toBe("284");
    expect(avatar?.getAttribute("height")).toBe("320");
  });

  it("publishes a static paper link", () => {
    expect(document.querySelector("#paper a")?.getAttribute("href")).toBe(
      "/assets/papers/wang-hao-rkdg-thesis.pdf"
    );
  });

  it("publishes the approved email contact link", () => {
    expect(document.querySelector("#contact a[href^=\"mailto:\"]")?.getAttribute("href")).toBe(
      "mailto:hwang0310@163.com"
    );
  });

  it("publishes the complete featured work and research story", () => {
    for (const copy of [
      "17 个地市",
      "18 类业务",
      "289 个日登记/清洗键",
      "255 个正式预测键",
      "54 个模拟预测日",
      "3.20%",
      "0.45%",
      "报告自动化工作流",
      "基于三角函数基 RKDG 方法的误差分析",
      "北京大学重庆大数据研究院",
    ]) {
      expect(document.body.textContent).toContain(copy);
    }

    expect(document.querySelector('#work [data-project="ai-automation"]')).not.toBeNull();
    expect(document.querySelector("#work")?.textContent).toContain("约 3.20%");
    expect(document.querySelector("#work")?.textContent).toContain(
      "合计偏差率约 0.45%"
    );
  });

  it("keeps the journey as a readable semantic ordered list without JavaScript", () => {
    const timeline = document.querySelector("ol.timeline");
    const entries = timeline?.querySelectorAll(":scope > li");

    expect(timeline?.getAttribute("aria-label")).toBe("教育与职业经历");
    expect(entries).toHaveLength(5);
    expect(entries?.[0]?.textContent).toContain("中国地质大学（武汉）");
    expect(entries?.[4]?.textContent).toContain("中国电信湖北省分公司");
  });

  it("exposes stable portrait and dog guide hooks without requiring JavaScript", () => {
    expect(document.querySelector("[data-portrait-stage]")).not.toBeNull();
    expect(document.querySelector("[data-portrait-sage]")).not.toBeNull();
    expect(document.querySelector("[data-portrait-warm]")).not.toBeNull();
    expect(document.querySelector("[data-dog-guide]")).not.toBeNull();
    expect(document.querySelector("[data-dog-pose]")).not.toBeNull();

    const portraitPictures = [
      ...document.querySelectorAll(
        ".mobile-portrait picture, [data-portrait-stage] picture, [data-about-portrait] picture"
      ),
    ];
    expect(portraitPictures).toHaveLength(5);
    for (const picture of portraitPictures) {
      const image = picture.querySelector("img");
      expect(image?.hasAttribute("width")).toBe(true);
      expect(image?.hasAttribute("height")).toBe(true);
    }

    expect(document.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1);
    expect(
      document.querySelector('link[rel="preload"][as="image"]')?.getAttribute("href")
    ).toBe("/images/portrait-sage.avif");
    expect(document.querySelector("[data-portrait-real] img")?.getAttribute("loading")).toBe(
      "lazy"
    );
  });

  it("provides AVIF, WebP, and JPEG fallbacks for every portrait picture", () => {
    const portraitPictures = [
      ...document.querySelectorAll(
        ".mobile-portrait picture, [data-portrait-stage] picture, [data-about-portrait] picture"
      ),
    ];

    for (const picture of portraitPictures) {
      const sources = [...picture.querySelectorAll(":scope > source")];
      const image = picture.querySelector(":scope > img");

      expect(sources.map((source) => source.getAttribute("type"))).toEqual([
        "image/avif",
        "image/webp",
      ]);
      expect(sources[0]?.getAttribute("srcset")).toMatch(/\.avif$/);
      expect(sources[1]?.getAttribute("srcset")).toMatch(/\.webp$/);
      expect(image?.getAttribute("src")).toMatch(/\.jpg$/);
    }
  });

  it("provides accessible controls, navigation, and hidden decoration", () => {
    expect(document.querySelector('nav[aria-label="主导航"]')).not.toBeNull();
    for (const target of ["about", "work", "paper", "journey", "contact"]) {
      expect(document.querySelector(`nav a[href="#${target}"]`)).not.toBeNull();
    }

    expect(document.querySelector('button[aria-label*="真实照片"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label*="小狗"]')).not.toBeNull();
    for (const decoration of ["star", "arrow", "chalk-line", "pawprints"]) {
      expect(
        document.querySelector(`[data-decoration="${decoration}"][aria-hidden="true"]`)
      ).not.toBeNull();
    }
  });
});
