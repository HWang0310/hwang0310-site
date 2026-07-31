export function initSiteNav(root: Document): () => void {
  const button = root.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const nav = root.querySelector<HTMLElement>("[data-site-nav]");

  if (!button || !nav) return () => undefined;

  const initialHidden = button.hidden;
  const initialExpanded = button.getAttribute("aria-expanded");
  const initialOpen = nav.getAttribute("data-open");
  button.hidden = false;

  const close = (returnFocus = false) => {
    button.setAttribute("aria-expanded", "false");
    delete nav.dataset.open;
    if (returnFocus) button.focus();
  };
  const toggle = () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";

    if (isOpen) {
      close();
      return;
    }

    button.setAttribute("aria-expanded", "true");
    nav.dataset.open = "true";
  };
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      close(true);
    }
  };
  const closeAfterAnchor = () => close();
  const anchors = [...nav.querySelectorAll<HTMLAnchorElement>("a")];

  button.addEventListener("click", toggle);
  root.addEventListener("keydown", handleKeydown);
  anchors.forEach((anchor) => anchor.addEventListener("click", closeAfterAnchor));

  return () => {
    button.removeEventListener("click", toggle);
    root.removeEventListener("keydown", handleKeydown);
    anchors.forEach((anchor) => anchor.removeEventListener("click", closeAfterAnchor));
    button.hidden = initialHidden;
    if (initialExpanded === null) {
      button.removeAttribute("aria-expanded");
    } else {
      button.setAttribute("aria-expanded", initialExpanded);
    }
    if (initialOpen === null) {
      nav.removeAttribute("data-open");
    } else {
      nav.setAttribute("data-open", initialOpen);
    }
  };
}
