import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { initScrollChapters } from "../src/scroll-chapters";

class FakeObserver {
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(element: Element): void {
    this.observed.add(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emit(entries: Array<[Element, number]>): void {
    this.callback(
      entries.map(([target, intersectionRatio]) =>
        ({
          target,
          intersectionRatio,
          isIntersecting: intersectionRatio > 0,
        }) as IntersectionObserverEntry
      ),
      this as unknown as IntersectionObserver
    );
  }
}

function createDocument(chapters: string[]): Document {
  return new JSDOM(
    `<main>${chapters
      .map((chapter) => `<section data-chapter="${chapter}"></section>`)
      .join("")}</main>`
  ).window.document;
}

describe("initScrollChapters", () => {
  it("reports the chapter with the greatest visible area", () => {
    const root = createDocument(["hero", "work"]);
    const changes: string[] = [];
    let observer: FakeObserver | undefined;

    initScrollChapters({
      root,
      createObserver: (callback) => (observer = new FakeObserver(callback)),
      onChange: (chapter) => changes.push(chapter),
    });

    observer?.emit([
      [root.querySelector('[data-chapter="hero"]')!, 0.28],
      [root.querySelector('[data-chapter="work"]')!, 0.78],
    ]);

    expect(changes).toEqual(["work"]);
  });

  it("keeps the current chapter when visible areas are tied", () => {
    const root = createDocument(["hero", "work"]);
    const changes: string[] = [];
    let observer: FakeObserver | undefined;

    initScrollChapters({
      root,
      createObserver: (callback) => (observer = new FakeObserver(callback)),
      onChange: (chapter) => changes.push(chapter),
    });

    const hero = root.querySelector('[data-chapter="hero"]')!;
    const work = root.querySelector('[data-chapter="work"]')!;
    observer?.emit([[hero, 0.78]]);
    observer?.emit([[work, 0.78]]);
    observer?.emit([[work, 0.79]]);

    expect(changes).toEqual(["hero", "work"]);
  });

  it("ignores invalid chapter hooks and disconnects during cleanup", () => {
    const root = createDocument(["hero", "not-a-chapter"]);
    const changes: string[] = [];
    let observer: FakeObserver | undefined;

    const cleanup = initScrollChapters({
      root,
      createObserver: (callback) => (observer = new FakeObserver(callback)),
      onChange: (chapter) => changes.push(chapter),
    });

    const invalid = root.querySelector('[data-chapter="not-a-chapter"]')!;
    observer?.emit([[invalid, 1]]);
    cleanup();
    observer?.emit([[root.querySelector('[data-chapter="hero"]')!, 1]]);

    expect(observer?.observed).toEqual(
      new Set([root.querySelector('[data-chapter="hero"]')!])
    );
    expect(changes).toEqual([]);
    expect(observer?.disconnected).toBe(true);
  });
});
