import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/motion.css";
import { initScrollChapters } from "./scroll-chapters";

export function bootstrap(root: Document): () => void {
  root.documentElement.dataset.enhanced = "true";
  const portraitStage = root.querySelector<HTMLElement>("[data-portrait-stage]");
  const initialPortraitState = portraitStage?.dataset.state;
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
    delete root.documentElement.dataset.enhanced;
    delete root.documentElement.dataset.activeChapter;
    if (portraitStage) portraitStage.dataset.state = initialPortraitState;
  };
}

if (typeof document !== "undefined") bootstrap(document);
