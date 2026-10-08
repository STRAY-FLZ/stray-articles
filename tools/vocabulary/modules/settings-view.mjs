import {
  escape,
  button,
  collectionOptions,
  examOptions,
  download,
} from "./ui.mjs";
import { validateBackup } from "./storage.mjs";
import { validatePreferences } from "./model.mjs";
export async function render(ctx) {
  const p = ctx.prefs;
  ctx.mount(`<h1>计划与数据</h1><section class="panel"><h2>每日学习计划</h2><form id="preferences"><div class="form-grid"><label>每日新词上限<input name="newLimit" type="number" min="0" max="500" value="${p.newLimit}" required></label><label>每日复习词义上限<input name="reviewLimit" type="number" min="0" max="5000" value="${p.reviewLimit}" required></label><label>目标记忆保持率（%）<input name="retention" type="number" min="70" max="99" value="${Math.round(p.retention * 100)}" required></label><label>每轮词义数量上限<input name="sessionSize" type="number" min="1" max="500" value="${p.sessionSize}" required></label><label>当前词库<select name="collectionId">${collectionOptions(ctx.collections, p.collectionId)}</select></label><label>当前考试<select name="exam">${examOptions(p.exam)}</select></label><label>统计时区<input name="timezone" value="${escape(p.timezone)}" required list="timezones"><datalist id="timezones"><option value="Asia/Shanghai"><option value="UTC"><option value="America/New_York"></datalist></label><label>高频阈值（每百万词义标注样本）<input name="highFrequencyThreshold" type="number" min="0" max="1000000" value="${p.highFrequencyThreshold}" required></label></div><label class="check"><input name="bookmarkPriority" type="checkbox" ${p.bookmarkPriority ? "checked" : ""}>同一到期时间优先收藏词</label><button class="primary" type="submit">保存学习计划</button></form><p class="small muted">默认每天 20 个新单词，目标保持率 90%。复习上限按每天独立复习词义计；学习中和重新学习的到期项目不因上限而丢弃。改变设置不会重置学习历史，但会重新生成本轮队列。</p></section>
 <section class="panel"><h2>完整备份与恢复</h2><p>一键备份词库、词义、收藏、FSRS 状态、学习会话、检测记录和设置。数据仅存于当前浏览器；清理浏览器数据会删除本地记录。</p>${button("导出完整 JSON 备份", "backup", 'class="primary"')}<label>恢复备份（替换当前本地档案全部数据）<input type="file" id="restore-file" accept=".json,application/json"></label><p class="small muted">恢复前完整验证结构及引用；确认后在单个事务中替换。不支持未明确校验的版本。建议先导出当前备份。</p><div id="backup-status" role="status"></div>${button("请求浏览器持久保存", "persist")}<p class="muted small">浏览器是否批准取决于其存储策略；此功能不能替代备份。</p></section>
 <section class="panel"><h2>本地档案</h2><p>当前档案：<strong>${escape(ctx.store.profile)}</strong>。不同档案使用独立 IndexedDB；不同设备和浏览器也各自独立。这不是登录账户或云同步。</p><form id="profile-form"><label>切换或创建本地档案标识<input name="profile" pattern="(?:[A-Za-z0-9_]|-){1,40}" value="${escape(ctx.store.profile)}" required maxlength="40"></label><button type="submit">打开此档案</button></form></section>`);
  ctx.on("submit", "#preferences", async (e, node) => {
    e.preventDefault();
    const f = new FormData(node);
    const value = validatePreferences({
      ...p,
      newLimit: Number(f.get("newLimit")),
      reviewLimit: Number(f.get("reviewLimit")),
      retention: Number(f.get("retention")) / 100,
      sessionSize: Number(f.get("sessionSize")),
      exam: f.get("exam"),
      collectionId: f.get("collectionId"),
      timezone: f.get("timezone"),
      highFrequencyThreshold: Number(f.get("highFrequencyThreshold")),
      bookmarkPriority: f.has("bookmarkPriority"),
    });
    await ctx.store.setPreferences(value);
    await ctx.store.run(["sessions"], "readwrite", (s) =>
      s.sessions.delete("learning"),
    );
    ctx.notice("计划已保存，学习历史保持不变");
    await ctx.refresh();
  });
  ctx.on("submit", "#profile-form", async (e, node) => {
    e.preventDefault();
    await ctx.switchProfile(new FormData(node).get("profile"));
  });
  ctx.on("click", "[data-action]", async (_, node) => {
    if (node.dataset.action === "backup") {
      const b = await ctx.store.backup();
      download(
        b,
        `vocabulary-${ctx.store.profile}-${new Date().toISOString().slice(0, 10)}.json`,
      );
      ctx.notice("已导出完整备份");
    }
    if (node.dataset.action === "persist") {
      const granted = await navigator.storage?.persist?.();
      ctx.notice(
        granted
          ? "浏览器已允许持久存储"
          : "浏览器尚未允许持久存储，请继续定期备份",
      );
    }
  });
  ctx.on("change", "#restore-file", async (_, node) => {
    const file = node.files[0];
    if (!file) return;
    try {
      if (file.size > 200 * 1024 * 1024) throw Error("备份超过 200 MB");
      const b = JSON.parse(await file.text());
      validateBackup(b);
      if (
        confirm(
          `备份有 ${b.data.words.length} 个词条、${b.data.events.length} 次学习记录。恢复将替换当前档案全部数据，是否继续？`,
        )
      ) {
        document.getElementById("backup-status").textContent =
          `正在恢复 ${b.data.words.length} 个词条，请勿关闭页面…`;
        await new Promise((r) => requestAnimationFrame(r));
        await ctx.store.restore(b);
        ctx.notice("备份已完整恢复");
        await ctx.refresh();
      }
    } catch (e) {
      ctx.notice("恢复失败：" + e.message, true);
    } finally {
      node.value = "";
    }
  });
}
