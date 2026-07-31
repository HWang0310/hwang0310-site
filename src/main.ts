import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/motion.css";
import { dogPoseForChapter, initDogGuide, setDogGuideChapter, setDogPose } from "./dog-guide";
import type { ChapterId } from "./site-content";
import { initPortraitFlip } from "./portrait-flip";
import { initScrollChapters } from "./scroll-chapters";
import { initSiteNav } from "./site-nav";

export function bootstrap(root: Document): () => void {
  root.documentElement.dataset.enhanced = "true";
  const portraitStage = root.querySelector<HTMLElement>("[data-portrait-stage]");
  const dogPoses = [...root.querySelectorAll<HTMLImageElement>("[data-dog-pose]")];
  const initialPortraitState = portraitStage?.dataset.state;
  const cleanupPortraitFlip = initPortraitFlip(root);
  const cleanupDogGuide = initDogGuide(root);
  const cleanupSiteNav = initSiteNav(root);
  const setChapter = (chapter: ChapterId) => {
    root.documentElement.dataset.activeChapter = chapter;
    setDogGuideChapter(root, chapter);
    dogPoses.forEach((dog) => setDogPose(dog, dogPoseForChapter(chapter)));
    if (portraitStage) {
      portraitStage.dataset.state =
        chapter === "hero" || chapter === "about" ? "sage" : "warm";
    }
  };
  setChapter("hero");
  const cleanupChapters = initScrollChapters({
    root,
    onChange: setChapter,
  });

  return () => {
    cleanupChapters();
    cleanupDogGuide();
    cleanupPortraitFlip();
    cleanupSiteNav();
    delete root.documentElement.dataset.enhanced;
    delete root.documentElement.dataset.activeChapter;
    if (portraitStage) portraitStage.dataset.state = initialPortraitState;
  };
}

if (typeof document !== "undefined") bootstrap(document);
