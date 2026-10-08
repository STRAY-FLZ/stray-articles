import {
  escape,
  button,
  collectionOptions,
  examOptions,
  bookmarkButton,
  definitions,
  dateTime,
  stateLabel,
  speak,
} from "./ui.mjs";
import { rankSenses } from "./ranking.mjs";
export async function render(ctx) {
  let page = 0,
    searchTimer,
    version = 0;
  ctx.mount(
    `<div class="page-title"><h1>我的词库</h1><a class="button" href="#import">导入 TXT</a></div><section class="panel"><div class="actions">${button("创建词库", "create-collection")}${button("重命名当前词库", "rename-collection")}${button("删除当前词库", "delete-collection")}<a href="#settings">备份与恢复 →</a></div><form id="library-filters" class="form-grid"><label>词库<select name="collectionId">${collectionOptions(ctx.collections, ctx.prefs.collectionId, true)}</select></label><label>英文前缀搜索<input name="query" type="search" placeholder="例如 adap" autocomplete="off"></label><label>考试分类<select name="exam">${examOptions(ctx.prefs.exam)}</select></label><label>学习状态<select name="status"><option value="all">全部词条</option><option value="studied">学过的词</option><option value="new">未学的词</option><option value="due">到期复习</option><option value="difficult">困难词</option><option value="1">学习中</option><option value="2">复习中</option><option value="3">重新学习</option></select></label><label class="check"><input type="checkbox" name="bookmarkOnly">仅收藏</label></form><div class="actions">${button("学习当前筛选范围", "target-filter", 'class="primary"')}${button("检测当前筛选范围", "assessment-filter")}</div><p class="muted small">同一词义跨词库共享学习进度。困难词依据 Again 或检测错题记录；收藏独立于记忆状态。目标复习遵守 FSRS 到期时间。</p></section><section id="word-list" class="panel" aria-live="polite"></section><section id="word-detail"></section>`,
  );
  function filters() {
    const f = new FormData(document.getElementById("library-filters"));
    return {
      collectionId: f.get("collectionId"),
      query: f.get("query"),
      exam: f.get("exam"),
      status: f.get("status"),
      bookmarkOnly: f.has("bookmarkOnly"),
      page,
    };
  }
  async function list() {
    const v = ++version;
    const r = await ctx.store.search(filters());
    if (v !== version || !ctx.alive()) return;
    document.getElementById("word-list").innerHTML =
      `<p>${r.total} 个词条 · 第 ${page + 1} / ${Math.max(1, Math.ceil(r.total / r.pageSize))} 页</p>${r.items.map((w) => `<article class="word-row"><div><button class="word-link" data-action="detail" data-word="${escape(w.wordId)}" lang="en">${escape(w.word)}</button><p>${escape(w.senses[0].definitionZH)}</p><span class="muted small">${w.senses.length} 个词义 · ${escape(w.examTags.join(" / "))} · ${w.studied ? "已学习" : "未学习"}</span></div>${bookmarkButton(w)}</article>`).join("") || "<p>当前范围没有词条，请调整筛选或导入词库。</p>"}<div class="actions">${button("上一页", "prev", page === 0 ? "disabled" : "")}${button("下一页", "more", (page + 1) * r.pageSize >= r.total ? "disabled" : "")}</div>`;
  }
  ctx.on("input", 'input[name="query"]', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 0;
      list().catch((e) => ctx.notice(e.message, true));
    }, 180);
  });
  ctx.on("change", "#library-filters", async () => {
    page = 0;
    await list();
  });
  ctx.on("submit", "#library-filters", (e) => e.preventDefault());
  ctx.on("click", "[data-action]", async (_, node) => {
    const id = node.dataset.word,
      action = node.dataset.action;
    if (action === "bookmark") {
      await ctx.store.bookmark(id);
      await list();
      if (document.getElementById("word-detail").dataset.word === id)
        await detail(id);
    }
    if (action === "detail") await detail(id);
    if (action === "speak")
      await speak(await ctx.store.get("words", id), ctx.notice);
    if (action === "prev") {
      page--;
      await list();
    }
    if (action === "more") {
      page++;
      await list();
    }
    if (action === "close-detail") {
      document.getElementById("word-detail").innerHTML = "";
      document.getElementById("word-detail").dataset.word = "";
    }
    if (action === "create-collection") {
      const name = prompt("新词库名称");
      if (name !== null) {
        const c = await ctx.store.createCollection(name);
        await ctx.store.setPreferences({ ...ctx.prefs, collectionId: c.id });
        await ctx.refresh();
      }
    }
    if (action === "rename-collection") {
      const selected = filters().collectionId;
      if (!selected) throw Error("请先选择一个词库");
      const c = ctx.collections.find((c) => c.id === selected);
      const name = prompt("新的词库名称", c.name);
      if (name !== null) {
        await ctx.store.renameCollection(selected, name);
        await ctx.refresh();
      }
    }
    if (action === "delete-collection") {
      const selected = filters().collectionId;
      if (!selected) throw Error("请先选择一个词库");
      if (selected === "default") throw Error("默认词库不可删除");
      if (
        confirm(
          "仅删除这个分类。其他词库引用和学习记录保留；不再属于任何词库的词条转入“我的词库”。是否继续？",
        )
      ) {
        await ctx.store.deleteCollection(selected);
        await ctx.refresh();
      }
    }
    if (
      [
        "target-word",
        "target-filter",
        "assessment-word",
        "assessment-filter",
      ].includes(action)
    ) {
      const ids = id
        ? [id]
        : (
            await ctx.store.search({ ...filters(), page: 0, pageSize: 15000 })
          ).items.map((w) => w.wordId);
      if (!ids.length) throw Error("当前范围没有可练习的词条");
      const selected = filters().collectionId;
      if (selected)
        await ctx.store.setPreferences({
          ...ctx.prefs,
          collectionId: selected,
          exam: filters().exam,
        });
      if (action.startsWith("assessment")) {
        ctx.assessmentTargets = ids;
        location.hash = "assessment";
      } else {
        ctx.targetIds = ids;
        location.hash = "learn";
      }
    }
  });
  async function detail(id) {
    const [w, units, history] = await Promise.all([
      ctx.store.get("words", id),
      ctx.store.all("units", "word", id),
      ctx.store.all("events", "word", id),
    ]);
    if (!ctx.alive()) return;
    const el = document.getElementById("word-detail");
    el.dataset.word = id;
    el.innerHTML = `<article class="panel"><div class="row"><h2 lang="en">${escape(w.word)}</h2>${button("关闭详情", "close-detail")}</div><p>${escape(w.ipaUS || "未提供美式 IPA")}</p><div class="actions">${bookmarkButton(w)}${button("▶ 美式发音", "speak", `data-word="${escape(id)}"`)}${button("学习这个词", "target-word", `data-word="${escape(id)}"`)}${button("检测这个词", "assessment-word", `data-word="${escape(id)}"`)}</div>${definitions(w, rankSenses(w.senses, filters().exam), filters().exam)}<h3>词义学习状态与下次复习</h3>${units.map((u) => `<p>词义 ${w.senses.findIndex((s) => s.senseId === u.senseId) + 1} · ${stateLabel(u)} · ${u.state ? escape(dateTime(u.due)) : "尚未学习"} · D ${u.card.difficulty.toFixed(2)} · S ${u.card.stability.toFixed(2)} 天 · ${u.card.reps} 次评分 · Again ${u.againCount} 次 · 检测错误 ${u.errors} 次</p>`).join("")}<details><summary>学习记录（${history.length} 条）</summary>${
      history
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50)
        .map(
          (e) =>
            `<p>${escape(dateTime(e.timestamp))} · ${["", "Again", "Hard", "Good", "Easy"][e.rating]} · 词义 ${w.senses.findIndex((s) => s.senseId === e.senseId) + 1}</p>`,
        )
        .join("") || "<p>尚无学习记录。</p>"
    }</details><details><summary>来源与导入批次</summary><pre>${escape(JSON.stringify({ source: w.sourceMetadata, imports: w.importMetadata }, null, 2))}</pre></details></article>`;
    el.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }
  await list();
}
