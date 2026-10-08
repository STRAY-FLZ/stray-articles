import {
  generateAssessment,
  assessmentResult,
  retryAssessment,
} from "./assessment.mjs";
import {
  escape,
  button,
  collectionOptions,
  examOptions,
  percent,
  dateTime,
} from "./ui.mjs";
export async function render(ctx) {
  let active = null,
    feedback = null,
    busy = false;
  const targetIds = ctx.assessmentTargets;
  ctx.assessmentTargets = null;
  const activeList = await ctx.store.all("assessments", "status", "active");
  active = activeList.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  function setup() {
    ctx.mount(
      `<h1>开始检测</h1><section class="panel"><p>英译中 30%，中译英 70%，均为选择题。检测记录独立保存，不改变 FSRS 复习间隔。</p>${active ? `<p>有未完成的检测：已回答 ${active.index} / ${active.questions.length} 题。</p>${button("继续上次检测", "resume", 'class="primary"')}` : ""}<form id="assessment-settings"><div class="form-grid"><label>模式<select name="mode"><option value="all">综合混合检测</option><option value="bookmarks">收藏词检测</option><option value="difficult">困难词检测</option></select></label><label>词库<select name="collectionId">${collectionOptions(ctx.collections, ctx.prefs.collectionId, true)}</select></label><label>考试范围<select name="exam">${examOptions(ctx.prefs.exam)}</select></label><label>题数<input name="count" type="number" min="2" max="100" value="20" required></label></div><label class="check"><input type="checkbox" name="studiedOnly">仅检测学过的词义</label><button class="primary" type="submit">生成混合检测</button></form><p class="small muted">不足的题数会缩减并明确提示；优先使用同词性且释义不冲突的干扰项，必要时减少选项。已有可靠词义频率或明确 highPriority 标注的词义可双向出现，间隔至少 1–3 题。</p></section><section class="panel"><h2>检测记录</h2><div id="assessment-history"></div></section>`,
    );
    ctx.store.all("assessments").then((records) => {
      if (!ctx.alive() || !document.getElementById("assessment-history"))
        return;
      document.getElementById("assessment-history").innerHTML =
        records
          .filter((a) => a.status === "completed")
          .sort((a, b) => b.completedAt - a.completedAt)
          .slice(0, 30)
          .map((a) => {
            const r = assessmentResult(a);
            return `<p>${escape(dateTime(a.completedAt))} · ${r.total} 题 · ${percent(r.accuracy)} ${button("查看结果", "history", `data-id="${escape(a.id)}"`)}</p>`;
          })
          .join("") || '<p class="muted">还没有完成的检测。</p>';
    });
  }
  function question() {
    if (!active) return;
    if (active.status === "completed" && !feedback) {
      results();
      return;
    }
    const q = feedback?.question || active.questions[active.index];
    ctx.mount(`<div class="page-title"><h1>词汇检测</h1>${button("暂停检测", "pause")}</div><section class="panel assessment-card"><div class="row"><span>${feedback ? active.index : active.index + 1} / ${active.questions.length}</span><span class="tag">${q.direction === "en" ? "英译中" : "中译英"}</span></div><progress value="${active.index}" max="${active.questions.length}" aria-label="检测进度"></progress><h2 lang="${q.direction === "en" ? "en" : "zh-CN"}">${escape(q.direction === "en" ? q.word : q.definitionZH)}</h2><p class="muted">${escape(q.partOfSpeech)}${q.direction === "en" ? " · 根据语境选择目标词义" : " · 选择对应的英文单词"}</p>${q.context ? `<blockquote><p lang="en">${escape(q.context)}</p><cite>${escape(q.source || "来源未提供")}</cite></blockquote>` : ""}
   <form id="answer-form"><div class="choices">${q.options.map((o, i) => `<label class="choice ${feedback && o.id === q.correctId ? "correct" : ""} ${feedback && o.id === feedback.answer.choiceId && !feedback.answer.correct ? "incorrect" : ""}"><input type="radio" name="choice" value="${escape(o.id)}" ${feedback ? "disabled" : ""} ${feedback?.answer.choiceId === o.id ? "checked" : ""} required><span>${String.fromCharCode(65 + i)}. ${escape(o.label)}</span></label>`).join("")}</div>${!feedback ? '<button class="primary" type="submit">提交答案</button>' : ""}</form>
   ${feedback ? `<div class="feedback" role="status"><h3>${feedback.answer.correct ? "回答正确" : "回答有误"}</h3><p>正确答案：${escape(q.options.find((o) => o.id === q.correctId).label)}</p><p>${escape(q.word)} · ${escape(q.definitionZH)}</p><p lang="en">${escape(q.definitionEN)}</p>${button(active.status === "completed" ? "查看检测结果" : "下一题", "next", 'class="primary"')}</div>` : ""}</section>`);
  }
  function results() {
    const r = assessmentResult(active);
    ctx.mount(
      `<h1>检测结果</h1><section class="panel"><p>完成时间：${escape(dateTime(active.completedAt))}</p><div class="stats"><div><strong>${r.total}</strong><span>题目</span></div><div><strong>${r.correct}</strong><span>正确</span></div><div><strong>${r.incorrect}</strong><span>错误</span></div><div><strong>${percent(r.accuracy)}</strong><span>总正确率</span></div></div><p>英译中：${percent(r.en)} · 中译英：${percent(r.zh)}</p><div class="actions">${button("立即重做错题", "retry", `${r.missed.length ? "" : "disabled"} class="primary"`)}${button("返回检测设置", "setup")}<a href="#learn">继续学习 →</a></div></section><section class="panel"><h2>错题及对应词义</h2>${r.missed.map(({ answer, question: q }) => `<article class="missed"><h3>${escape(q.word)} · ${escape(q.partOfSpeech)}</h3><p>${escape(q.definitionZH)}</p><p lang="en">${escape(q.definitionEN)}</p><p>你的选择：${escape(q.options.find((o) => o.id === answer.choiceId)?.label)}</p><p>正确选择：${escape(q.options.find((o) => o.id === q.correctId)?.label)}</p></article>`).join("") || "<p>本次全部正确。</p>"}</section>`,
    );
  }
  ctx.on("submit", "#assessment-settings", async (e, node) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const start = node.querySelector('button[type="submit"]');
    start.disabled = true;
    start.textContent = "正在生成有效题目…";
    try {
      const f = new FormData(node);
      const settings = {
        mode: f.get("mode"),
        collectionId: f.get("collectionId"),
        exam: f.get("exam"),
        count: Number(f.get("count")),
        studiedOnly: f.has("studiedOnly"),
        targetIds,
      };
      if (
        !Number.isInteger(settings.count) ||
        settings.count < 2 ||
        settings.count > 100
      )
        throw Error("题数应为 2–100");
      const [words, units] = await Promise.all([
        ctx.store.all("words"),
        ctx.store.all("units"),
      ]);
      let generated;
      if (words.length > 500 && typeof Worker !== "undefined") {
        const worker = new Worker(
          new URL("./assessment-worker.mjs", import.meta.url),
          { type: "module" },
        );
        generated = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(Error("生成检测超时，请缩小词库范围"));
          }, 120000);
          worker.onmessage = ({ data }) => {
            clearTimeout(timeout);
            worker.terminate();
            data.error ? reject(Error(data.error)) : resolve(data.result);
          };
          worker.onerror = () => {
            clearTimeout(timeout);
            worker.terminate();
            reject(Error("检测生成器无法启动"));
          };
          worker.postMessage({ words, units, settings, prefs: ctx.prefs });
        });
      } else generated = generateAssessment(words, units, settings, ctx.prefs);
      await ctx.store.put("assessments", generated);
      active = generated;
      feedback = null;
      if (active.questions.length < settings.count)
        ctx.notice(
          `有效题目不足，已生成 ${active.questions.length} 题（英译中 ${active.allocation.en}，中译英 ${active.allocation.zh}）`,
        );
      question();
    } finally {
      busy = false;
      if (start.isConnected) {
        start.disabled = false;
        start.textContent = "生成混合检测";
      }
    }
  });
  ctx.on("submit", "#answer-form", async (e, node) => {
    e.preventDefault();
    if (busy || feedback) return;
    const choice = new FormData(node).get("choice");
    if (!choice) {
      ctx.notice("请先选择答案", true);
      return;
    }
    busy = true;
    try {
      const q = active.questions[active.index];
      active = await ctx.store.submitAssessment(
        active.id,
        active.index,
        choice,
      );
      feedback = { question: q, answer: active.answers.at(-1) };
      question();
    } finally {
      busy = false;
    }
  });
  ctx.on("click", "[data-action]", async (_, node) => {
    if (busy) return;
    switch (node.dataset.action) {
      case "resume":
        feedback = null;
        question();
        break;
      case "pause":
        setup();
        break;
      case "next":
        feedback = null;
        question();
        break;
      case "setup":
        feedback = null;
        active = null;
        setup();
        break;
      case "retry":
        active = retryAssessment(active);
        await ctx.store.put("assessments", active);
        feedback = null;
        question();
        break;
      case "history":
        active = await ctx.store.get("assessments", node.dataset.id);
        feedback = null;
        results();
        break;
    }
  });
  setup();
}
