import { VocabularyStore } from "./modules/storage.mjs";
import { escape } from "./modules/ui.mjs";
const views = {
  home: "home",
  learn: "learn",
  assessment: "assessment",
  library: "library",
  import: "import",
  analytics: "analytics",
  settings: "settings",
};
const root = document.getElementById("view");
let store,
  controller,
  generation = 0,
  profile = "local",
  targetIds = null,
  assessmentTargets = null;
try {
  profile = localStorage.getItem("stray-vocabulary-profile") || "local";
} catch {
  /* This page remains usable when localStorage is unavailable. */
}
const notice = (message, error = false) => {
  const el = document.getElementById("notice");
  el.textContent = message;
  el.dataset.error = String(error);
  el.hidden = false;
};
async function render() {
  const version = ++generation;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const route = location.hash.slice(1).split("/")[0] || "home",
    view = views[route] || "home";
  root.innerHTML = '<p role="status">正在读取本地学习记录…</p>';
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  try {
    const [prefs, collections, module] = await Promise.all([
      store.preferences(),
      store.all("collections"),
      import(`./modules/${view}-view.mjs`),
    ]);
    if (version !== generation) return;
    const ctx = {
      store,
      prefs,
      collections,
      signal,
      notice,
      alive: () => version === generation,
      mount: (html) => {
        if (version === generation) root.innerHTML = html;
      },
      refresh: render,
      switchProfile: async (next) => {
        const candidate = await new VocabularyStore(next).open();
        store.close();
        store = candidate;
        try {
          localStorage.setItem("stray-vocabulary-profile", next);
        } catch {
          /* This page remains usable when localStorage is unavailable. */
        }
        targetIds = null;
        assessmentTargets = null;
        notice("已切换独立本地档案");
        await render();
      },
      on: (type, selector, handler) => {
        root.addEventListener(
          type,
          (e) => {
            const node = e.target.closest(selector);
            if (!node || !root.contains(node)) return;
            Promise.resolve(handler(e, node)).catch((err) =>
              notice(err.message || "操作失败，请重试", true),
            );
          },
          { signal },
        );
      },
    };
    Object.defineProperties(ctx, {
      targetIds: {
        get: () => targetIds,
        set: (v) => {
          targetIds = v;
        },
      },
      assessmentTargets: {
        get: () => assessmentTargets,
        set: (v) => {
          assessmentTargets = v;
        },
      },
    });
    await module.render(ctx);
    if (ctx.alive()) {
      document.title = `${{ home: "英语背词", learn: "开始学习", assessment: "开始检测", library: "我的词库", import: "导入词库", analytics: "学习统计", settings: "计划与数据" }[view]} · Stray`;
      root.querySelector("h1")?.setAttribute("tabindex", "-1");
    }
  } catch (e) {
    if (version === generation) {
      root.innerHTML = `<section class="panel"><h1>暂时无法打开页面</h1><p>${escape(e.message)}</p><p>请检查浏览器本地存储权限、可用空间或静态资源是否完整。已有数据不会因此清空。</p><a href="#home">返回应用首页</a></section>`;
      notice(e.message, true);
    }
  }
}
window.addEventListener("hashchange", render);
window.addEventListener("vocabulary-blocked", () =>
  notice("另一个页面正在升级本地数据库，请关闭其他词汇页面后刷新", true),
);
document
  .getElementById("dismiss-notice")
  .addEventListener(
    "click",
    () => (document.getElementById("notice").hidden = true),
  );
try {
  store = await new VocabularyStore(profile).open();
  await render();
} catch (e) {
  notice(e.message, true);
  root.textContent = "本地数据库无法打开，请允许 IndexedDB 存储后刷新。";
}
