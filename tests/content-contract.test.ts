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
});
