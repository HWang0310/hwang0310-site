export function bootstrap(root: Document): () => void {
  root.documentElement.dataset.enhanced = "true";
  return () => delete root.documentElement.dataset.enhanced;
}

if (typeof document !== "undefined") bootstrap(document);
