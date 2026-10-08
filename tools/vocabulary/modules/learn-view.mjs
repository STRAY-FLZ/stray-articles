import { buildQueue, newSession, releasePending } from "./session.mjs";
import { dayKey, uid } from "./model.mjs";
import { preview, intervalLabel } from "./scheduler.mjs";
import { rankSenses } from "./ranking.mjs";
import {
  escape,
  button,
  definitions,
  bookmarkButton,
  stateLabel,
  speak,
  dateTime,
} from "./ui.mjs";
export async function render(ctx) {
  let session = await ctx.store.get("sessions", "learning");
  const targetIds = ctx.targetIds;
  ctx.targetIds = null;
  if (
    !session ||
    session.day !== dayKey(Date.now(), ctx.prefs.timezone) ||
    session.collectionId !== ctx.prefs.collectionId ||
    session.exam !== ctx.prefs.exam ||
    targetIds
  ) {
    const [scopeUnits, due, events] = await Promise.all([
      ctx.store.all("units", "collection", ctx.prefs.collectionId),
      ctx.store.due(),
      ctx.store.todayEvents(Date.now(), ctx.prefs.timezone),
    ]);
    const units = [
      ...new Map(
        [
          ...scopeUnits.filter((u) => u.state === 0 || u.card.reps > 0),
          ...due,
        ].map((u) => [u.unitId, u]),
      ).values(),
    ];
    const queue = buildQueue({ units, events, prefs: ctx.prefs, targetIds });
    session = newSession(queue, ctx.prefs, Date.now(), targetIds);
    await ctx.store.put("sessions", session);
  } else {
    session = releasePending(session);
    await ctx.store.put("sessions", session);
  }
  let current = null,
    word = null,
    revealed = false,
    locked = false,
    estimates = null;
  const cache = new Map();
  const loadWord = (id) => {
    if (!cache.has(id)) {
      if (cache.size > 3) cache.delete(cache.keys().next().value);
      cache.set(id, ctx.store.get("words", id));
    }
    return cache.get(id);
  };
  async function show() {
    if (!ctx.alive()) return;
    session = releasePending(session);
    await ctx.store.put("sessions", session);
    current = await ctx.store.get("units", session.queue[session.index] || "");
    if (current && current.state > 0 && current.due > Date.now()) {
      session.index++;
      await ctx.store.put("sessions", session);
      return show();
    }
    if (!current) {
      const wait = session.pending[0]?.due;
      ctx.mount(
        `<h1>本轮学习已完成</h1><section class="panel"><p>本轮已完成 ${session.completed} 次记忆评分。</p>${wait ? `<p>下一次短期复习：${escape(dateTime(wait))}。学习义务已保存，返回时会重新检查到期时间。</p>` : "<p>到期项目已完成或已达到本轮上限。未完成的项目仍保存在词库。</p>"}<div class="actions">${button("重新检查学习队列", "restart", 'class="primary"')}<a href="#library">查看我的词库 →</a></div></section>`,
      );
      return;
    }
    word = await loadWord(current.wordId);
    if (!word) throw Error("词条缺失，请恢复完整备份");
    revealed = false;
    estimates = preview(current, Date.now(), ctx.prefs.retention);
    const nextId = session.queue[session.index + 1];
    if (nextId)
      ctx.store.get("units", nextId).then((u) => u && loadWord(u.wordId));
    paint();
  }
  function paint() {
    if (!ctx.alive()) return;
    const sense = word.senses.find((s) => s.senseId === current.senseId),
      ordered = rankSenses(word.senses, ctx.prefs.exam);
    ctx.mount(`<div class="page-title"><h1>开始学习</h1>${button("暂停并返回首页", "pause")}</div><p class="muted">${session.index + 1} / ${session.queue.length} · 已评分 ${session.completed} 次 · ${escape(stateLabel(current))}</p>
   <article id="flashcard" class="flashcard ${word.bookmark ? "bookmarked" : ""}" aria-label="词汇闪卡"><div class="row"><span class="eyebrow">ACTIVE RECALL / 独立词义</span>${bookmarkButton(word)}</div><h2 class="word" lang="en">${escape(word.word)}</h2><div class="row word-meta"><span>${escape(word.ipaUS || "未提供美式 IPA")}</span>${button("▶ 美式发音", "speak", 'aria-label="播放美式发音"')}</div><p class="muted">${escape(sense.partOfSpeech)} · 目标词义 ${ordered.findIndex((s) => s.senseId === sense.senseId) + 1} / ${word.senses.length}</p>
   <p class="small muted">先回忆该词性下的含义；评分仅影响本次目标词义。多义词可先选择一个含义回忆，揭示后核对目标。</p>
   ${!revealed ? `<div class="recall-space"><p>你还记得它的意思吗？</p>${button("显示释义", "reveal", `class="primary" ${locked ? "disabled" : ""}`)}<p class="small muted">空格显示释义 · 1–4 评分 · B 收藏</p></div>` : `<div class="answer">${definitions(word, ordered, ctx.prefs.exam, sense.senseId)}</div>`}
   <div class="rating-grid" aria-label="FSRS 记忆评分">${[
     [1, "Again", "忘记了"],
     [2, "Hard", "困难"],
     [3, "Good", "记住了"],
     [4, "Easy", "很简单"],
   ]
     .map(([rating, name, label]) =>
       button(
         `<strong>${name}</strong><span>${label}</span><small>${escape(intervalLabel(estimates[rating].card.due))}</small>`,
         "grade",
         `data-rating="${rating}" ${!revealed || locked ? "disabled" : ""}`,
       ),
     )
     .join(
       "",
     )}</div><p class="small muted">FSRS · 目标保持率 ${Math.round(ctx.prefs.retention * 100)}% · 下次间隔由当前记忆状态计算</p></article>`);
    if (revealed)
      document
        .querySelector('[data-rating="3"]')
        ?.focus({ preventScroll: true });
  }
  ctx.on("click", "[data-action]", async (_, node) => {
    const action = node.dataset.action;
    if (action === "pause") {
      location.hash = "home";
      return;
    }
    if (action === "restart") {
      await ctx.store.run(["sessions"], "readwrite", (s) =>
        s.sessions.delete("learning"),
      );
      await ctx.refresh();
      return;
    }
    if (locked || !current) return;
    if (action === "reveal") {
      revealed = true;
      paint();
      return;
    }
    if (action === "speak") {
      await speak(word, ctx.notice);
      return;
    }
    if (action === "bookmark") {
      word.bookmark = await ctx.store.bookmark(word.wordId);
      cache.delete(word.wordId);
      paint();
      return;
    }
    if (action === "grade" && revealed) {
      locked = true;
      document
        .querySelectorAll("[data-rating]")
        .forEach((b) => (b.disabled = true));
      try {
        const result = await ctx.store.commitGrade({
          unitId: current.unitId,
          revision: current.revision,
          rating: Number(node.dataset.rating),
          session,
          prefs: ctx.prefs,
          eventId: uid(),
        });
        session = result.session;
        const card = document.getElementById("flashcard");
        card?.classList.add("leaving");
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
          await new Promise((r) => setTimeout(r, 250));
        await show();
        document.getElementById("flashcard")?.classList.add("arriving");
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
          await new Promise((r) => setTimeout(r, 250));
      } catch (e) {
        ctx.notice(e.message, true);
        await ctx.refresh();
      } finally {
        locked = false;
        const reveal = document.querySelector('[data-action="reveal"]');
        if (reveal) reveal.disabled = false;
      }
    }
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        !ctx.alive() ||
        locked ||
        e.repeat ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      )
        return;
      let action;
      if (e.code === "Space" && !revealed && e.target.tagName !== "BUTTON")
        action = "reveal";
      else if (/^[1-4]$/.test(e.key) && revealed) {
        e.preventDefault();
        document.querySelector(`[data-rating="${e.key}"]`)?.click();
        return;
      } else if (e.key.toLowerCase() === "b") action = "bookmark";
      if (action) {
        e.preventDefault();
        document.querySelector(`[data-action="${action}"]`)?.click();
      }
    },
    { signal: ctx.signal },
  );
  await show();
}
