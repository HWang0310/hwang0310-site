import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/motion.css";
import { initPortraitFlip } from "./portrait-flip";
import { initScrollChapters } from "./scroll-chapters";
import { initSiteNav } from "./site-nav";

export function bootstrap(root: Document): () => void {
  root.documentElement.dataset.enhanced = "true";
  const portraitStage = root.querySelector<HTMLElement>("[data-portrait-stage]");
  const initialPortraitState = portraitStage?.dataset.state;
  const cleanupPortraitFlip = initPortraitFlip(root);
  const cleanupSiteNav = initSiteNav(root);
  const cleanupChapters = initScrollChapters({
    root,
    onChange: (chapter) => {
      root.documentElement.dataset.activeChapter = chapter;
      if (portraitStage) {
        portraitStage.dataset.state =
          chapter === "hero" || chapter === "about" ? "sage" : "warm";
      }
    },
  });

  return () => {
    cleanupChapters();
    cleanupPortraitFlip();
    cleanupSiteNav();
    delete root.documentElement.dataset.enhanced;
    delete root.documentElement.dataset.activeChapter;
    if (portraitStage) portraitStage.dataset.state = initialPortraitState;
  };
}

if (typeof document !== "undefined") bootstrap(document);
