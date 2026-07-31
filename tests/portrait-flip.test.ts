import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { initPortraitFlip } from "../src/portrait-flip";

function createDocument(): Document {
  return new JSDOM(`
    <article data-about-portrait data-face="ai">
      <picture data-portrait-ai aria-hidden="false"><img alt="AI 肖像" /></picture>
      <picture data-portrait-real aria-hidden="true"><img alt="真实照片" /></picture>
      <button type="button" aria-pressed="false" data-portrait-toggle>
        <span>查看真实照片</span>
      </button>
    </article>
  `).window.document;
}

describe("initPortraitFlip", () => {
  it("switches the portrait, pressed state, and button text", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-portrait-toggle]")!;
    const card = root.querySelector<HTMLElement>("[data-about-portrait]")!;

    initPortraitFlip(root);
    button.click();

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(card.dataset.face).toBe("real");
    expect(button.getAttribute("aria-label")).toBe("查看 AI 肖像");
    expect(button.textContent).toContain("查看 AI 肖像");
    expect(root.querySelector("[data-portrait-ai]")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    expect(root.querySelector("[data-portrait-real]")?.getAttribute("aria-hidden")).toBe(
      "false"
    );
  });

  it("uses Space without scrolling and toggles only once", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-portrait-toggle]")!;
    const card = root.querySelector<HTMLElement>("[data-about-portrait]")!;

    initPortraitFlip(root);
    const event = new root.defaultView!.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(card.dataset.face).toBe("real");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("removes its listener during cleanup", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-portrait-toggle]")!;
    const card = root.querySelector<HTMLElement>("[data-about-portrait]")!;
    const cleanup = initPortraitFlip(root);

    cleanup();
    button.click();

    expect(card.dataset.face).toBe("ai");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("does nothing when portrait hooks are absent", () => {
    const root = new JSDOM("<main></main>").window.document;

    expect(() => initPortraitFlip(root)).not.toThrow();
  });
});
