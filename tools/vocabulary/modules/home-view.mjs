import { calculateAnalytics } from "./analytics.mjs";
export async function render(ctx) {
  const [units, events, assessments] = await Promise.all(
    ["units", "events", "assessments"].map((n) => ctx.store.all(n)),
  );
  const a = calculateAnalytics(units, events, assessments, ctx.prefs);
  ctx.mount(`<section class="intro"><span class="eyebrow">VOCABULARY / 个人学习空间</span><h1>英语背词</h1><p>先试着回忆，再让每一次复习更合时宜。</p><p class="muted small">词库与学习记录保存在此浏览器。请定期备份，跨设备使用需手动导入备份。</p></section>
 <section class="entry-grid" aria-label="主要功能"><a class="entry" href="#learn"><span class="eyebrow">01 / ACTIVE RECALL</span><h2>开始学习</h2><p>新词、到期复习与短期重学，按 FSRS 安排。</p><span>进入学习 →</span></a><a class="entry" href="#assessment"><span class="eyebrow">02 / ASSESSMENT</span><h2>开始检测</h2><p>30% 英译中，70% 中译英。检查具体词义。</p><span>开始检测 →</span></a><a class="entry" href="#library"><span class="eyebrow">03 / COLLECTIONS</span><h2>我的词库</h2><p>导入个人词汇，整理收藏，查看学习记录。</p><span>管理词库 →</span></a></section>
 ${!units.length ? '<section class="panel onboarding"><h2>从你的第一份词库开始</h2><p>上传 GLM 导出的 TXT，预览确认后再保存。尚无正式词库时，可导入明确标注的教学演示文件体验。</p><a class="button" href="#import">导入词库</a></section>' : ""}
 <section aria-label="今日学习统计" class="stats"><div><strong>${a.todayNew}</strong><span>今日新学单词</span></div><div><strong>${a.todayReviewedWords}</strong><span>今日复习单词</span></div><div><strong>${a.dueWords}</strong><span>到期单词（${a.dueUnits} 词义）</span></div><div><strong>${a.studied}</strong><span>累计学过单词</span></div><div><strong>${a.streak}</strong><span>连续学习天数</span></div></section>
 <section class="panel"><div class="row"><h2>今日新词目标</h2><a href="#settings">调整计划 →</a></div><progress value="${a.todayNew}" max="${Math.max(ctx.prefs.newLimit, 1)}" aria-label="今日新词目标"></progress><p>${a.todayNew} / ${ctx.prefs.newLimit} 个新单词 · 今日完成 ${a.todayReviews} 次复习事件</p><a class="plain-link" href="#analytics">查看学习统计 →</a></section>`);
}
