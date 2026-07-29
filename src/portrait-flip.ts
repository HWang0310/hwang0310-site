const labels = {
  ai: "翻到真实照片",
  real: "翻到 AI 肖像",
} as const;

type PortraitFace = keyof typeof labels;

function getFace(card: HTMLElement): PortraitFace {
  return card.dataset.face === "real" ? "real" : "ai";
}

function setToggleLabel(button: HTMLButtonElement, label: string): void {
  const textElement = button.lastElementChild;

  if (textElement) {
    textElement.textContent = label;
  } else {
    button.textContent = label;
  }
}

function setPortraitFace(
  card: HTMLElement,
  button: HTMLButtonElement,
  face: PortraitFace
): void {
  card.dataset.face = face;
  button.setAttribute("aria-pressed", String(face === "real"));
  button.setAttribute(
    "aria-label",
    `切换 AI 肖像与真实照片，当前显示${face === "real" ? "真实照片" : "AI 肖像"}`
  );
  setToggleLabel(button, labels[face]);
}

export function initPortraitFlip(root: Document): () => void {
  const bindings = [...root.querySelectorAll<HTMLButtonElement>("[data-portrait-toggle]")]
    .map((button) => ({
      button,
      card: button.closest<HTMLElement>("[data-about-portrait]"),
    }))
    .filter(
      (binding): binding is { button: HTMLButtonElement; card: HTMLElement } =>
        binding.card !== null
    );

  const cleanups = bindings.map(({ button, card }) => {
    setPortraitFace(card, button, getFace(card));

    const toggle = () => {
      setPortraitFace(card, button, getFace(card) === "ai" ? "real" : "ai");
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Spacebar") return;

      event.preventDefault();
      toggle();
    };

    button.addEventListener("click", toggle);
    button.addEventListener("keydown", handleKeydown);

    return () => {
      button.removeEventListener("click", toggle);
      button.removeEventListener("keydown", handleKeydown);
    };
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
