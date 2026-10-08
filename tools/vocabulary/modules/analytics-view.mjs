import { calculateAnalytics } from "./analytics.mjs";
import { escape, percent, dateTime } from "./ui.mjs";
export async function render(ctx) {
  const [units, events, assessments] = await Promise.all(
    ["units", "events", "assessments"].map((n) => ctx.store.all(n)),
  );
  const a = calculateAnalytics(units, events, assessments, ctx.prefs);
  const metrics = [
    ["词条数", a.wordCount],
    ["独立词义记忆单元", a.unitCount],
    ["学过的独立单词", a.studied],
    ["掌握的单词", a.mastered],
    ["学习评分事件", a.totalEvents],
    ["复习事件", a.reviewEvents],
    ["到期单词", a.dueWords],
    ["到期词义", a.dueUnits],
    ["连续学习天数", a.streak],
  ];
  ctx.mount(`<h1>学习统计</h1><section class="stats">${metrics.map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("")}</section><section class="panel"><h2>词义状态分布</h2><div class="state-grid">${["未学习", "学习中", "复习中", "重新学习"].map((s, i) => `<p>${s}：${a.states[i]} 个词义</p>`).join("")}</div><p class="small muted">掌握定义：一个单词的所有词义均处于 Review，每个词义至少评分 3 次、稳定性至少 30 天，当前 R 不低于目标保持率。不会在首次答对后计为掌握。</p></section>
 <section class="panel"><h2>近 7 天学习趋势</h2>${chart(a.trends.slice(-7))}<h2>近 30 天学习趋势</h2>${chart(a.trends)}<p class="small muted">新词按当天首次学到的独立单词计；复习按已有学习记录的词义评分事件计。统计时区：${escape(ctx.prefs.timezone)}。</p></section>
 <section class="panel"><h2>检测统计</h2><div class="stats"><div><strong>${a.assessments}</strong><span>完成检测</span></div><div><strong>${a.questions}</strong><span>已答题目</span></div><div><strong>${percent(a.accuracy)}</strong><span>总正确率</span></div></div><p>英译中：${percent(a.en)} · 中译英：${percent(a.zh)}</p><details><summary>历史检测成绩</summary>${
   a.scores
     .sort((a, b) => b.date - a.date)
     .slice(0, 100)
     .map(
       (s) =>
         `<p>${escape(dateTime(s.date))} · ${s.total} 题 · ${percent(s.accuracy)}</p>`,
     )
     .join("") || "<p>暂无记录</p>"
 }</details><h3>近 30 天错误率变化</h3><div class="table-scroll"><table><thead><tr><th>日期</th><th>题数</th><th>错误率</th></tr></thead><tbody>${
   a.errorTrend
     .filter((t) => t.total)
     .map(
       (t) =>
         `<tr><td>${t.date}</td><td>${t.total}</td><td>${percent(t.errors / t.total)}</td></tr>`,
     )
     .join("") || '<tr><td colspan="3">暂无记录</td></tr>'
 }</tbody></table></div><h3>经常答错的词义</h3><div id="frequent-errors"></div><p>检测不会修改 FSRS 时间，建议回到主动回忆学习巩固薄弱词义。</p></section>`);
  const items = await Promise.all(
    a.frequentErrors.map(async ([unitId, count]) => {
      const u = units.find((u) => u.unitId === unitId),
        w = await ctx.store.get("words", u.wordId),
        s = w.senses.find((s) => s.senseId === u.senseId);
      return `<p><strong lang="en">${escape(w.word)}</strong> · ${escape(s.definitionZH)} · 错误 ${count} 次</p>`;
    }),
  );
  if (ctx.alive())
    document.getElementById("frequent-errors").innerHTML =
      items.join("") || "<p>暂无错题。</p>";
}
function chart(rows) {
  const max = Math.max(1, ...rows.map((r) => r.newWords + r.reviews));
  return `<div class="trend-chart" role="img" aria-label="学习趋势柱状图，详细数据见下表">${rows.map((r) => `<div class="trend-column" title="${r.date}：新词 ${r.newWords}，复习 ${r.reviews}"><div class="bar reviews" style="height:${(r.reviews / max) * 110}px"></div><div class="bar new" style="height:${(r.newWords / max) * 110}px"></div><span>${r.date.slice(8)}</span></div>`).join("")}</div><p class="small">蓝色：新单词 · 金色：复习事件</p><details><summary>查看每日详细数据</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>新单词</th><th>复习事件</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.date}</td><td>${r.newWords}</td><td>${r.reviews}</td></tr>`).join("")}</tbody></table></div></details>`;
}
