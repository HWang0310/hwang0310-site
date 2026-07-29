import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { initSiteNav } from "../src/site-nav";

function createDocument(): Document {
  return new JSDOM(`
    <header>
      <button type="button" aria-expanded="false" data-nav-toggle>菜单</button>
      <nav data-site-nav>
        <a href="#about">关于</a>
      </nav>
    </header>
  `).window.document;
}

describe("initSiteNav", () => {
  it("opens and closes the navigation with the menu button", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-nav-toggle]")!;
    const nav = root.querySelector<HTMLElement>("[data-site-nav]")!;

    initSiteNav(root);
    button.click();

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(nav.dataset.open).toBe("true");

    button.click();

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(nav.dataset.open).toBeUndefined();
  });

  it("closes the navigation after an anchor is selected", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-nav-toggle]")!;
    const nav = root.querySelector<HTMLElement>("[data-site-nav]")!;
    const link = nav.querySelector<HTMLAnchorElement>("a")!;

    initSiteNav(root);
    button.click();
    link.click();

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(nav.dataset.open).toBeUndefined();
  });

  it("closes on Escape and returns focus to the menu button", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-nav-toggle]")!;
    const nav = root.querySelector<HTMLElement>("[data-site-nav]")!;

    initSiteNav(root);
    button.click();
    nav.dispatchEvent(
      new root.defaultView!.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      })
    );

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(nav.dataset.open).toBeUndefined();
    expect(root.activeElement).toBe(button);
  });

  it("removes navigation listeners during cleanup", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-nav-toggle]")!;
    const cleanup = initSiteNav(root);

    cleanup();
    button.click();

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("does nothing when navigation hooks are absent", () => {
    const root = new JSDOM("<main></main>").window.document;

    expect(() => initSiteNav(root)).not.toThrow();
  });
});
