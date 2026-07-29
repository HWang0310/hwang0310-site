import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { initPortraitFlip } from "../src/portrait-flip";

function createDocument(): Document {
  return new JSDOM(`
    <article data-about-portrait data-face="ai">
      <button type="button" aria-pressed="false" data-portrait-toggle>
        <span>翻到真实照片</span>
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
    expect(button.textContent).toContain("翻到 AI 肖像");
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
