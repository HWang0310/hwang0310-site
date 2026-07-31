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

  it("follows the approved editorial chapter order and numbering", () => {
    const chapterIds = [
      ...document.querySelectorAll<HTMLElement>(".content-column > section.chapter"),
    ].map((section) => section.id);

    expect(chapterIds).toEqual([
      "hero",
      "about",
      "journey",
      "work",
      "paper",
      "contact",
    ]);
    expect(
      [...document.querySelectorAll(".site-nav a")].map((link) =>
        link.getAttribute("href")
      )
    ).toEqual(["#about", "#journey", "#work", "#paper", "#contact"]);
    expect(document.querySelector("#about .eyebrow")?.textContent).toContain(
      "01 / ABOUT"
    );
    expect(document.querySelector("#journey .eyebrow")?.textContent).toContain(
      "02 / JOURNEY"
    );
    expect(document.querySelector("#work .eyebrow")?.textContent).toContain(
      "03 / SELECTED WORK"
    );
    expect(document.querySelector("#paper .eyebrow")?.textContent).toContain(
      "04 / RESEARCH"
    );
    expect(document.querySelector("#contact .eyebrow")?.textContent).toContain(
      "05 / SAY HELLO"
    );
  });

  it("publishes the complete personal motto with its editorial artwork", () => {
    const motto =
      "同志，你的磁场弱了?毛主席说过:在对的方向坚持长期主义，藐视一切暂时性困难，人生没有过不去的坎和战胜不了的困难，要像建设新中国一样建设自己。";
    const section = document.querySelector("[data-motto]");
    const picture = section?.querySelector("picture");

    expect(section?.textContent).toContain("个人座右铭");
    expect(section?.textContent).toContain("自我勉励");
    expect(section?.textContent).toContain(motto);
    expect(picture?.querySelector('source[type="image/avif"]')?.getAttribute("srcset")).toBe(
      "/images/motto-mao.avif"
    );
    expect(picture?.querySelector('source[type="image/webp"]')?.getAttribute("srcset")).toBe(
      "/images/motto-mao.webp"
    );
    expect(picture?.querySelector("img")?.getAttribute("src")).toBe(
      "/images/motto-mao.jpg"
    );
    expect(picture?.querySelector("img")?.getAttribute("alt")).toContain(
      "艺术形象"
    );
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
      "充分离散误差估计",
      "负模估计",
      "SIAC 后处理",
      "线性对流方程",
      "Burgers 方程",
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

  it("shows three explained numerical experiment exhibits from the thesis", () => {
    const exhibits = [
      ...document.querySelectorAll<HTMLElement>("#paper [data-thesis-experiment]"),
    ];

    expect(exhibits).toHaveLength(3);
    expect(exhibits.map((exhibit) => exhibit.dataset.sourcePage)).toEqual([
      "47",
      "48",
      "50-51",
    ]);
    for (const exhibit of exhibits) {
      const image = exhibit.querySelector("img");
      expect(image?.getAttribute("loading")).toBe("lazy");
      expect(image?.hasAttribute("width")).toBe(true);
      expect(image?.hasAttribute("height")).toBe(true);
      expect(exhibit.querySelector("figcaption")?.textContent?.trim().length).toBeGreaterThan(
        24
      );
    }
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
    expect(portraitPictures).toHaveLength(7);
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
    expect(document.querySelectorAll("[data-portrait-switcher]")).toHaveLength(3);
    expect(document.querySelectorAll("[data-portrait-toggle]")).toHaveLength(3);
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
