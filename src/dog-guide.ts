import type { ChapterId } from "./site-content";

export type DogPose = "inspect" | "point" | "run" | "rest";

const poseByChapter: Record<ChapterId, DogPose> = {
  hero: "point",
  about: "point",
  work: "inspect",
  paper: "point",
  journey: "run",
  contact: "rest",
};

const poseDetails: Record<DogPose, { alt: string; src: string }> = {
  inspect: {
    src: "/images/dog-inspect.webp",
    alt: "小狗认真查看收入预估项目",
  },
  point: {
    src: "/images/dog-point.webp",
    alt: "小狗指向下一段内容",
  },
  run: {
    src: "/images/dog-run.webp",
    alt: "小狗沿着经历时间线奔跑",
  },
  rest: {
    src: "/images/dog-rest.webp",
    alt: "小狗安静地趴下休息",
  },
};

const chapterActions: Record<ChapterId, { label: string; copy: string }> = {
  hero: { label: "小狗向导：前往作品", copy: "往下走，作品在这里" },
  about: { label: "小狗向导：前往作品", copy: "去看看正在做的作品" },
  work: { label: "小狗向导：聚焦收入预估项目", copy: "打开收入预估项目" },
  paper: { label: "小狗向导：聚焦硕士论文", copy: "看看这篇硕士论文" },
  journey: { label: "小狗向导：查看下一段经历", copy: "沿着经历继续走" },
  contact: { label: "小狗向导：返回顶部", copy: "回到故事开头" },
};

const requestedPoseVersions = new WeakMap<HTMLImageElement, number>();

export function dogPoseForChapter(chapter: ChapterId): DogPose {
  return poseByChapter[chapter];
}

export function setDogPose(element: HTMLImageElement, pose: DogPose): void {
  const ImageConstructor = element.ownerDocument.defaultView?.Image;
  if (!ImageConstructor) return;

  const version = (requestedPoseVersions.get(element) ?? 0) + 1;
  requestedPoseVersions.set(element, version);
  const detail = poseDetails[pose];
  const preloadedImage = new ImageConstructor();

  preloadedImage.onload = () => {
    if (requestedPoseVersions.get(element) !== version) return;

    element.src = detail.src;
    element.alt = detail.alt;
    element.dataset.pose = pose;
  };
  preloadedImage.src = detail.src;
}

function chapterFromValue(value: string | undefined): ChapterId {
  return value && value in chapterActions ? (value as ChapterId) : "hero";
}

function scrollTo(element: Element | null): void {
  element?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focus(element: HTMLElement | null): void {
  element?.focus({ preventScroll: true });
}

function updateGuide(button: HTMLButtonElement, chapter: ChapterId): void {
  const action = chapterActions[chapter];
  button.dataset.chapter = chapter;
  button.setAttribute("aria-label", action.label);
  const copy = button.querySelector<HTMLElement>("[data-dog-guide-copy]");
  if (copy) copy.textContent = action.copy;
}

export function setDogGuideChapter(root: Document, chapter: ChapterId): void {
  root
    .querySelectorAll<HTMLButtonElement>("[data-dog-guide]")
    .forEach((button) => updateGuide(button, chapter));
}

export function initDogGuide(root: Document): () => void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-dog-guide]")];
  if (buttons.length === 0) return () => undefined;

  const cleanups = buttons.map((button) => {
    const initialHidden = button.hidden;
    const initialLabel = button.getAttribute("aria-label");
    const initialChapter = button.getAttribute("data-chapter");
    const copy = button.querySelector<HTMLElement>("[data-dog-guide-copy]");
    const initialCopy = copy?.textContent ?? null;
    let nextJourneyEntry = 0;

    button.hidden = false;
    updateGuide(button, chapterFromValue(root.documentElement.dataset.activeChapter));

    const activate = () => {
      switch (chapterFromValue(button.dataset.chapter)) {
        case "hero":
        case "about":
          scrollTo(root.querySelector("#work"));
          return;
        case "work":
          focus(
            root.querySelector<HTMLElement>(
              '#work [data-project="income-forecast"] a[href]'
            ) ?? root.querySelector<HTMLElement>("#work a[href]")
          );
          return;
        case "paper":
          focus(root.querySelector<HTMLElement>("#paper a[href]"));
          return;
        case "journey": {
          const entries = [...root.querySelectorAll<HTMLElement>("[data-timeline-entry]")];
          const entry = entries[nextJourneyEntry % entries.length];
          if (!entry) return;
          nextJourneyEntry = (nextJourneyEntry + 1) % entries.length;
          scrollTo(entry);
          focus(entry);
          return;
        }
        case "contact":
          scrollTo(root.querySelector("#top"));
      }
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Spacebar") return;
      event.preventDefault();
      activate();
    };

    button.addEventListener("click", activate);
    button.addEventListener("keydown", handleKeydown);

    return () => {
      button.removeEventListener("click", activate);
      button.removeEventListener("keydown", handleKeydown);
      button.hidden = initialHidden;
      if (initialLabel === null) button.removeAttribute("aria-label");
      else button.setAttribute("aria-label", initialLabel);
      if (initialChapter === null) delete button.dataset.chapter;
      else button.dataset.chapter = initialChapter;
      if (copy && initialCopy !== null) copy.textContent = initialCopy;
    };
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
