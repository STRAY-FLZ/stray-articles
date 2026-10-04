/* Match the Education disclosure: 800 ms, reversible height and opacity.
   Native details remains the fallback when JavaScript is unavailable. */
(() => {
  "use strict";
  const directory = document.querySelector(".reading-directory");
  if (!directory) return;
  const DURATION = 800;
  const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const compact = window.matchMedia("(max-width: 960px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function enhance(disclosure) {
    const summary = disclosure.querySelector(":scope > summary");
    const panel = disclosure.querySelector(":scope > .reading-panel");
    const content = panel?.querySelector(":scope > .reading-content");
    if (!summary || !panel || !content) return null;
    let targetOpen = disclosure.open;
    let heightAnimation = null;
    let opacityAnimation = null;

    function updateState() {
      disclosure.dataset.expanded = String(targetOpen);
      summary.setAttribute("aria-expanded", String(targetOpen));
      panel.setAttribute("aria-hidden", String(!targetOpen));
      // Links disappearing during a closing animation must not remain tabbable.
      panel.inert = !targetOpen;
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
      disclosure.open = targetOpen;
      cancelAnimations();
      updateState();
    }

    summary.addEventListener("click", (event) => {
      event.preventDefault();
      // Measure the in-flight frame before cancelling, so rapid clicks reverse
      // smoothly instead of restarting from fully open or fully closed.
      const startHeight = disclosure.open ? panel.getBoundingClientRect().height : 0;
      const startOpacity = disclosure.open ? Number.parseFloat(getComputedStyle(content).opacity) : 0;
      targetOpen = !targetOpen;
      cancelAnimations();
      updateState();
      if (reducedMotion.matches || typeof panel.animate !== "function" || typeof content.animate !== "function") {
        settle();
        return;
      }

      // Keep native details open until its closing animation finishes.
      disclosure.open = true;
      const endHeight = targetOpen ? content.getBoundingClientRect().height : 0;
      const options = { duration: DURATION, easing: EASING, fill: "both" };
      heightAnimation = panel.animate(
        [{ height: `${startHeight}px` }, { height: `${endHeight}px` }], options,
      );
      opacityAnimation = content.animate(
        [{ opacity: startOpacity }, { opacity: targetOpen ? 1 : 0 }], options,
      );
      const currentAnimation = heightAnimation;
      currentAnimation.onfinish = () => {
        if (heightAnimation === currentAnimation) settle();
      };
    });

    disclosure.addEventListener("toggle", () => {
      if (!heightAnimation) {
        targetOpen = disclosure.open;
        updateState();
      }
    });
    updateState();
    return {
      settle,
      setOpen(open) { targetOpen = open; settle(); },
    };
  }

  const directoryControl = enhance(directory);
  const controls = [directoryControl, ...Array.from(directory.querySelectorAll(".reading-group"), enhance)].filter(Boolean);
  const updateLayout = () => {
    controls.forEach(control => control.settle());
    if (directoryControl) directoryControl.setOpen(!compact.matches);
    else directory.open = !compact.matches;
  };
  updateLayout();
  compact.addEventListener("change", updateLayout);

  let viewportWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth !== viewportWidth) {
      viewportWidth = window.innerWidth;
      controls.forEach(control => control.settle());
    }
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) controls.forEach(control => control.settle());
  });
})();
