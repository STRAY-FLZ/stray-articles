/* Run in the head before the stylesheet and first paint, on every page. */
(() => {
  const root = document.documentElement;
  const STORAGE_KEY = "stray-theme";
  const isTheme = (value) => value === "light" || value === "dark";
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  const systemTheme = () => (system?.matches ? "dark" : "light");
  let preference = null;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) preference = saved;
  } catch {
    // Private or restricted storage must not prevent switching or reading.
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    const dark = theme === "dark";
    button.setAttribute("aria-checked", String(dark));
    button.title = dark ? "关闭夜间模式" : "开启夜间模式";
  }

  applyTheme(preference || systemTheme());

  function setup() {
    const button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    applyTheme(root.dataset.theme);
    root.dataset.themeReady = "true";

    button.addEventListener("click", () => {
      preference = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(preference);
      try {
        window.localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // The current page still works if persistence is unavailable.
      }
    });

    // Keep other open pages in step with a manual choice or cleared storage.
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      preference = isTheme(event.newValue) ? event.newValue : null;
      applyTheme(preference || systemTheme());
    });

    // Back/forward cache can restore an older document without rerunning this
    // script, so refresh its choice before the restored page is used again.
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        preference = isTheme(saved) ? saved : null;
      } catch {
        // Retain the current page's choice when storage is restricted.
      }
      applyTheme(preference || systemTheme());
    });

    // Follow the device only until the visitor makes an explicit choice.
    system?.addEventListener?.("change", () => {
      if (!preference) applyTheme(systemTheme());
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }
})();
