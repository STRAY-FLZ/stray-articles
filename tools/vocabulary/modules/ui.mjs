import { STATES } from "./model.mjs";
import { representativeExample } from "./ranking.mjs";
export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const percent = (n) =>
  n === null || n === undefined ? "暂无记录" : `${(n * 100).toFixed(1)}%`;
export const dateTime = (n) =>
  n ? new Date(n).toLocaleString("zh-CN") : "未安排";
export const button = (text, action, attrs = "") =>
  `<button type="button" data-action="${action}" ${attrs}>${text}</button>`;
export function options(items, value) {
  return items
    .map(
      ([id, label]) =>
        `<option value="${escape(id)}" ${id === value ? "selected" : ""}>${escape(label)}</option>`,
    )
    .join("");
}
export const collectionOptions = (collections, value, all = false) =>
  options(
    [
      ...(all ? [["", "全部词库"]] : []),
      ...collections.map((c) => [c.id, c.name]),
    ],
    value,
  );
export const examOptions = (value) =>
  options(
    [
      ["all", "全部考试"],
      ["CET-4", "CET-4"],
      ["CET-6", "CET-6"],
      ["IELTS", "IELTS"],
    ],
    value,
  );
export const bookmarkButton = (w) =>
  button(
    w.bookmark ? "★ 已收藏" : "☆ 收藏",
    "bookmark",
    `data-word="${escape(w.wordId)}" aria-pressed="${Boolean(w.bookmark)}" class="bookmark ${w.bookmark ? "selected" : ""}"`,
  );
export function definitions(
  word,
  senses = word.senses,
  exam = "all",
  targetSenseId = null,
) {
  return `<ol class="senses">${senses
    .map((s) => {
      const ex = representativeExample(s, exam);
      return `<li class="sense ${s.senseId === targetSenseId ? "target-sense" : ""}"><p><span class="tag">${escape(s.partOfSpeech)}</span> <strong>${escape(s.definitionZH)}</strong>${s.senseId === targetSenseId ? ' <span class="tag">当前记忆单元</span>' : ""}</p><p lang="en">${escape(s.definitionEN)}</p><p class="muted small">释义来源：${escape(s.dictionarySource || "来源未提供")}${s.dictionaryVersion ? " · " + escape(s.dictionaryVersion) : ""}</p>${ex ? `<blockquote><p lang="en">${escape(ex.sentence)}</p><p>${escape(ex.exampleTranslation || "译文未提供")}</p><cite>例句来源：${escape(ex.exampleSource || "来源未提供")}</cite></blockquote>` : '<p class="muted small">未提供对应例句</p>'}</li>`;
    })
    .join("")}</ol>`;
}
export function stateLabel(unit) {
  return STATES[unit.state] || "未知";
}
export function download(value, name, type = "application/json") {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function speak(word, onNotice) {
  try {
    if (word.audioUS) {
      const audio = new Audio(word.audioUS);
      await audio.play();
      return;
    }
  } catch {
    onNotice("音频无法播放，尝试浏览器美式语音");
  }
  if (!("speechSynthesis" in globalThis)) {
    onNotice("当前浏览器不支持语音播放");
    return;
  }
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang.toLowerCase() === "en-us");
  const u = new SpeechSynthesisUtterance(word.word);
  u.lang = "en-US";
  if (voice) u.voice = voice;
  u.rate = 0.85;
  u.onerror = () => onNotice("语音播放失败，请检查浏览器语音服务");
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  if (!voice) onNotice("未找到 en-US 语音，已请求浏览器默认英语语音");
}
