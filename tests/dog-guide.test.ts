import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  dogPoseForChapter,
  initDogGuide,
  setDogGuideChapter,
  setDogPose,
} from "../src/dog-guide";

class ControlledImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly images: ControlledImage[];

  constructor(images: ControlledImage[]) {
    this.images = images;
  }

  set src(_value: string) {
    this.images.push(this);
  }

  load(): void {
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

function createDocument(): Document {
  return new JSDOM(`
    <main id="top">
      <section id="about">关于</section>
      <section id="journey">
        <ol>
          <li data-timeline-entry tabindex="-1">第一段</li>
          <li data-timeline-entry tabindex="-1">第二段</li>
        </ol>
      </section>
      <section id="work"><a href="https://example.com/income">收入预估</a></section>
      <section id="paper"><a href="/paper.pdf">论文</a></section>
      <button data-dog-guide type="button"><img data-dog-pose data-pose="point" src="/images/dog-point.webp" alt="小狗指向下一段内容"><span data-dog-guide-copy>作品</span></button>
    </main>
  `).window.document;
}

function installImageStub(root: Document): ControlledImage[] {
  const images: ControlledImage[] = [];
  const ImageStub = class extends ControlledImage {
    constructor() {
      super(images);
    }
  };
  Object.defineProperty(root.defaultView!, "Image", {
    configurable: true,
    value: ImageStub,
  });
  return images;
}

function recordScroll(element: Element): () => number {
  let calls = 0;
  Object.assign(element, {
    scrollIntoView: () => {
      calls += 1;
    },
  });
  return () => calls;
}

function recordScrollOptions(element: Element): () => ScrollIntoViewOptions[] {
  const calls: ScrollIntoViewOptions[] = [];
  Object.assign(element, {
    scrollIntoView: (options: ScrollIntoViewOptions) => {
      calls.push(options);
    },
  });
  return () => calls;
}

function installMotionPreference(root: Document, reducedMotion: boolean): void {
  Object.defineProperty(root.defaultView!, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" && reducedMotion,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
}

describe("dogPoseForChapter", () => {
  it("maps every chapter to its approved dog pose", () => {
    expect(dogPoseForChapter("hero")).toBe("point");
    expect(dogPoseForChapter("about")).toBe("point");
    expect(dogPoseForChapter("work")).toBe("inspect");
    expect(dogPoseForChapter("paper")).toBe("point");
    expect(dogPoseForChapter("journey")).toBe("run");
    expect(dogPoseForChapter("contact")).toBe("rest");
  });
});

describe("setDogPose", () => {
  it("synchronizes the source, alternative text, and pose after every approved image loads", () => {
    for (const [pose, src, alt] of [
      ["inspect", "/images/dog-inspect.webp", "小狗认真查看收入预估项目"],
      ["point", "/images/dog-point.webp", "小狗指向下一段内容"],
      ["run", "/images/dog-run.webp", "小狗沿着经历时间线奔跑"],
      ["rest", "/images/dog-rest.webp", "小狗安静地趴下休息"],
    ] as const) {
      const root = createDocument();
      const loaders = installImageStub(root);
      const dog = root.querySelector<HTMLImageElement>("[data-dog-pose]")!;

      setDogPose(dog, pose);
      loaders[0]?.load();

      expect(dog.getAttribute("src")).toBe(src);
      expect(dog.getAttribute("alt")).toBe(alt);
      expect(dog.dataset.pose).toBe(pose);
    }
  });

  it("keeps the visible pose when a replacement image fails", () => {
    const root = createDocument();
    const loaders = installImageStub(root);
    const dog = root.querySelector<HTMLImageElement>("[data-dog-pose]")!;

    setDogPose(dog, "rest");
    loaders[0]?.fail();

    expect(dog.getAttribute("src")).toBe("/images/dog-point.webp");
    expect(dog.getAttribute("alt")).toBe("小狗指向下一段内容");
    expect(dog.dataset.pose).toBe("point");
  });
});

describe("initDogGuide", () => {
  it.each([
    { reducedMotion: false, expectedBehavior: "smooth" },
    { reducedMotion: true, expectedBehavior: "auto" },
  ] as const)(
    "requests $expectedBehavior scrolling when reduced motion is $reducedMotion",
    ({ reducedMotion, expectedBehavior }) => {
      const root = createDocument();
      const button = root.querySelector<HTMLButtonElement>("[data-dog-guide]")!;
      const scrollOptions = recordScrollOptions(root.querySelector("#about")!);
      installMotionPreference(root, reducedMotion);

      initDogGuide(root);
      setDogGuideChapter(root, "hero");
      button.click();

      expect(scrollOptions()).toEqual([
        { behavior: expectedBehavior, block: "start" },
      ]);
    }
  );

  it("sets a chapter-specific accessible label and carries out each guide action", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-dog-guide]")!;
    const about = root.querySelector("#about")!;
    const work = root.querySelector("#work")!;
    const top = root.querySelector("#top")!;
    const firstJourneyEntry = root.querySelector<HTMLElement>("[data-timeline-entry]")!;
    const secondJourneyEntry = root.querySelectorAll<HTMLElement>("[data-timeline-entry]")[1]!;
    const aboutScrolls = recordScroll(about);
    const topScrolls = recordScroll(top);
    const firstJourneyScrolls = recordScroll(firstJourneyEntry);
    const secondJourneyScrolls = recordScroll(secondJourneyEntry);

    initDogGuide(root);

    setDogGuideChapter(root, "hero");
    button.click();
    expect(button.getAttribute("aria-label")).toBe("小狗向导：前往关于");
    expect(aboutScrolls()).toBe(1);

    setDogGuideChapter(root, "about");
    button.click();
    expect(button.getAttribute("aria-label")).toBe("小狗向导：前往经历");
    expect(firstJourneyScrolls()).toBe(1);

    setDogGuideChapter(root, "work");
    button.click();
    expect(button.getAttribute("aria-label")).toBe("小狗向导：聚焦收入预估项目");
    expect(root.activeElement).toBe(root.querySelector("#work a"));

    setDogGuideChapter(root, "paper");
    button.click();
    expect(button.getAttribute("aria-label")).toBe("小狗向导：聚焦硕士论文");
    expect(root.activeElement).toBe(root.querySelector("#paper a"));

    setDogGuideChapter(root, "journey");
    button.click();
    button.click();
    button.click();
    expect(button.getAttribute("aria-label")).toBe("小狗向导：查看下一段经历");
    expect(firstJourneyScrolls()).toBe(3);
    expect(secondJourneyScrolls()).toBe(1);
    expect(root.activeElement).toBe(firstJourneyEntry);

    setDogGuideChapter(root, "contact");
    button.click();
    expect(button.getAttribute("aria-label")).toBe("小狗向导：返回顶部");
    expect(topScrolls()).toBe(1);
  });

  it("allows Space to activate the current guide action without page scrolling", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-dog-guide]")!;
    const aboutScrolls = recordScroll(root.querySelector("#about")!);

    initDogGuide(root);
    setDogGuideChapter(root, "hero");
    const event = new root.defaultView!.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(aboutScrolls()).toBe(1);
  });

  it("removes its listeners during cleanup", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-dog-guide]")!;
    const aboutScrolls = recordScroll(root.querySelector("#about")!);
    const cleanup = initDogGuide(root);

    cleanup();
    button.click();

    expect(aboutScrolls()).toBe(0);
  });

  it("restores every dog image attribute captured before chapter pose updates", () => {
    const root = createDocument();
    const loaders = installImageStub(root);
    const dog = root.querySelector<HTMLImageElement>("[data-dog-pose]")!;
    const cleanup = initDogGuide(root);

    setDogPose(dog, "rest");
    loaders[0]?.load();
    cleanup();

    expect(dog.getAttribute("src")).toBe("/images/dog-point.webp");
    expect(dog.getAttribute("alt")).toBe("小狗指向下一段内容");
    expect(dog.getAttribute("data-pose")).toBe("point");
  });

  it("invalidates a pending dog image load when the guide is cleaned up", () => {
    const root = createDocument();
    const loaders = installImageStub(root);
    const dog = root.querySelector<HTMLImageElement>("[data-dog-pose]")!;
    const cleanup = initDogGuide(root);

    setDogPose(dog, "rest");
    cleanup();
    loaders[0]?.load();

    expect(dog.getAttribute("src")).toBe("/images/dog-point.webp");
    expect(dog.getAttribute("alt")).toBe("小狗指向下一段内容");
    expect(dog.getAttribute("data-pose")).toBe("point");
  });

  it("reveals mobile guides only after enhancement and restores their no-JavaScript state", () => {
    const root = createDocument();
    const button = root.querySelector<HTMLButtonElement>("[data-dog-guide]")!;
    button.hidden = true;
    const cleanup = initDogGuide(root);

    expect(button.hidden).toBe(false);

    cleanup();

    expect(button.hidden).toBe(true);
  });

  it("does nothing when dog guide hooks are absent", () => {
    const root = new JSDOM("<main></main>").window.document;

    expect(() => initDogGuide(root)).not.toThrow();
    expect(() => setDogGuideChapter(root, "work")).not.toThrow();
  });
});
