(() => {
  const disclosure = document.querySelector(".education-disclosure");
  if (!disclosure || typeof disclosure.animate !== "function") return;

  const summary = disclosure.querySelector(".education-summary");
  const panel = disclosure.querySelector(".education-panel");
  const content = disclosure.querySelector(".education-content");
  if (!summary || !panel || !content) return;

  const DURATION = 800;
  const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let targetOpen = disclosure.open;
  let heightAnimation = null;
  let opacityAnimation = null;

  function updateState() {
    disclosure.dataset.expanded = String(targetOpen);
    summary.setAttribute("aria-expanded", String(targetOpen));
    panel.setAttribute("aria-hidden", String(!targetOpen));
  }

  function cancelAnimations() {
    if (heightAnimation) {
      heightAnimation.onfinish = null;
      heightAnimation.cancel();
      heightAnimation = null;
    }
    if (opacityAnimation) {
      opacityAnimation.cancel();
      opacityAnimation = null;
    }
  }

  function settle() {
    // Hide a closing panel before clearing its temporary animated height.
    disclosure.open = targetOpen;
    cancelAnimations();
    updateState();
  }

  summary.addEventListener("click", (event) => {
    event.preventDefault();

    // Stop unfinished anchor scrolling without moving the clicked heading.
    const root = document.documentElement;
    if (getComputedStyle(root).scrollBehavior === "smooth") {
      const previousBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(window.scrollX, window.scrollY);
      root.style.scrollBehavior = previousBehavior;
    }

    // Read the current frame first so a second click reverses without jumping.
    const startHeight = disclosure.open ? panel.getBoundingClientRect().height : 0;
    const startOpacity = disclosure.open ? Number.parseFloat(getComputedStyle(content).opacity) : 0;
    targetOpen = !targetOpen;
    cancelAnimations();
    updateState();

    if (reducedMotion.matches) {
      settle();
      return;
    }

    // Native details stays open until the closing animation reaches zero.
    disclosure.open = true;
    const endHeight = targetOpen ? content.getBoundingClientRect().height : 0;
    const options = { duration: DURATION, easing: EASING, fill: "both" };
    heightAnimation = panel.animate(
      [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
      options,
    );
    opacityAnimation = content.animate(
      [{ opacity: startOpacity }, { opacity: targetOpen ? 1 : 0 }],
      options,
    );

    const currentAnimation = heightAnimation;
    currentAnimation.onfinish = () => {
      if (heightAnimation === currentAnimation) settle();
    };
  });

  // Keep native actions (such as browser find) in sync with the enhanced control.
  disclosure.addEventListener("toggle", () => {
    if (!heightAnimation) {
      targetOpen = disclosure.open;
      updateState();
    }
  });

  let viewportWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth !== viewportWidth) {
      viewportWidth = window.innerWidth;
      if (heightAnimation) settle();
    }
  });

  const handleMotionPreference = () => {
    if (reducedMotion.matches && heightAnimation) settle();
  };
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", handleMotionPreference);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(handleMotionPreference);
  }

  updateState();
})();
