import type { ChapterId } from "./site-content";

type ChapterObserver = {
  observe(element: Element): void;
  disconnect(): void;
};

export interface ScrollChapterOptions {
  root: Document;
  createObserver?: (callback: IntersectionObserverCallback) => ChapterObserver;
  onChange(chapter: ChapterId): void;
}

const chapterIds = new Set<ChapterId>([
  "hero",
  "about",
  "work",
  "paper",
  "journey",
  "contact",
]);

function getChapterId(element: Element): ChapterId | undefined {
  const chapter = element.getAttribute("data-chapter");
  return chapter && chapterIds.has(chapter as ChapterId)
    ? (chapter as ChapterId)
    : undefined;
}

function createDefaultObserver(callback: IntersectionObserverCallback): ChapterObserver {
  return new IntersectionObserver(callback, {
    rootMargin: "-25% 0px -45% 0px",
    threshold: [0, 0.25, 0.5, 0.75, 1],
  });
}

export function initScrollChapters({
  root,
  createObserver,
  onChange,
}: ScrollChapterOptions): () => void {
  const chapters = [...root.querySelectorAll("section[data-chapter]")]
    .map((element) => ({ element, chapter: getChapterId(element) }))
    .filter(
      (entry): entry is { element: Element; chapter: ChapterId } =>
        entry.chapter !== undefined
    );

  const observerFactory =
    createObserver ??
    (typeof IntersectionObserver === "undefined" ? undefined : createDefaultObserver);

  if (!observerFactory || chapters.length === 0) return () => undefined;

  const ratios = new Map<Element, number>();
  let activeChapter: ChapterId | undefined;
  let isActive = true;

  const observer = observerFactory((entries) => {
    if (!isActive) return;

    for (const entry of entries) {
      if (!chapters.some((chapter) => chapter.element === entry.target)) continue;
      ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    }

    let highestRatio = 0;
    let nextChapter: ChapterId | undefined;

    for (const { element, chapter } of chapters) {
      const ratio = ratios.get(element) ?? 0;
      if (ratio > highestRatio) {
        highestRatio = ratio;
        nextChapter = chapter;
      }
    }

    if (!nextChapter || highestRatio <= 0) return;

    const currentChapterIsTied = chapters.some(
      ({ element, chapter }) =>
        chapter === activeChapter && (ratios.get(element) ?? 0) === highestRatio
    );

    if (currentChapterIsTied || nextChapter === activeChapter) return;

    activeChapter = nextChapter;
    onChange(nextChapter);
  });

  chapters.forEach(({ element }) => observer.observe(element));

  return () => {
    isActive = false;
    observer.disconnect();
  };
}
