import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/motion.css";

export function bootstrap(root: Document): () => void {
  root.documentElement.dataset.enhanced = "true";
  return () => delete root.documentElement.dataset.enhanced;
}

if (typeof document !== "undefined") bootstrap(document);
