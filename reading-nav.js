/* Native disclosures remain usable without JavaScript. On small screens,
   keep the article selector compact above the text instead of hiding it. */
(() => {
  "use strict";
  const directory = document.querySelector(".reading-directory");
  if (!directory) return;
  const compact = window.matchMedia("(max-width: 960px)");
  const updateLayout = () => { directory.open = !compact.matches; };
  updateLayout();
  compact.addEventListener("change", updateLayout);
})();
