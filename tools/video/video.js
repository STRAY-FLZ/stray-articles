const $ = (id) => document.getElementById(id);
const TERMINAL = new Set(["ready", "error", "cancelled", "expired"]);
const MODES = { video: "完整视频", audio: "仅音轨", split: "音画分离" };
const STAGES = { queued: "等待处理", parsing: "正在确认视频源", downloading: "正在下载", processing: "正在处理音画", ready: "提取完成", error: "提取失败", cancelled: "已取消", expired: "结果已过期" };
const STORE = "stray-video-session-v1";
let analysis = null;
let busy = false;
let online = false;
let pollTimer;
let pollActive = false;
let healthTimer;
let apiBase = "";
let storageAvailable = true;
let session;
try {
  const configured = window.STRAY_VIDEO_CONFIG?.apiBase?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("invalid API");
    apiBase = url.href.replace(/\/$/, "");
  }
} catch { apiBase = ""; }
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved && saved.base === apiBase && /^[a-f0-9]{64}$/.test(saved.token)) session = { token: saved.token, jobs: (saved.jobs || []).filter((j) => /^[a-f0-9]{32}$/.test(j.id)).slice(0, 10) };
} catch { storageAvailable = false; }
if (!session) session = { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""), jobs: [] };
const persist = () => {
  try { localStorage.setItem(STORE, JSON.stringify({ base: apiBase, ...session })); }
  catch { storageAvailable = false; }
};
function feedback(message, type = "") { $("feedback").textContent = message; $("feedback").className = `feedback ${type ? `is-${type}` : ""}`; }
function extractLink(text) {
  const matches = text.match(/https?:\/\/[^\s<>"'“”]+/gi) || [];
  if (matches.length !== 1) throw new Error("请粘贴一条视频链接，或只包含一条链接的分享文字。");
  const raw = matches[0].replace(/[，。；、！!）)】\]]+$/, "");
  const url = new URL(raw);
  const hosts = new Set(["bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv", "douyin.com", "www.douyin.com", "v.douyin.com", "iesdouyin.com", "www.iesdouyin.com", "xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com"]);
  if (!hosts.has(url.hostname) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("目前支持哔哩哔哩、抖音和小红书的视频链接。");
  return url.href;
}
async function request(path, { method = "GET", body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${session.token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(typeof data.detail === "string" ? data.detail : "服务暂时无法处理，请稍后重试。"); e.status = response.status; throw e; }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("等待服务响应超时，请稍后重试。");
    if (e instanceof TypeError) throw new Error("暂时无法连接下载服务，请稍后重试。");
    throw e;
  } finally { clearTimeout(timer); }
}
function bytes(n) { if (!n) return ""; const unit = n >= 1024 ** 3 ? [1024 ** 3, "GB"] : [1024 ** 2, "MB"]; return `${(n / unit[0]).toFixed(1)} ${unit[1]}`; }
function duration(n) { if (!n) return ""; return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`; }
function controls() {
  $("analyze-button").disabled = busy || !online;
  $("download-button").disabled = busy || !online || !analysis;
  $("reset-button").disabled = busy;
}
function updateOptions() {
  const mode = document.querySelector('[name="mode"]:checked').value;
  $("quality").disabled = mode === "audio";
  $("audio-format").disabled = mode === "video";
  $("audio-note").textContent = mode === "video" ? "完整视频保留原有音轨。" : "原始音轨不重新编码；MP3 使用 192 kbps。";
  $("quality-note").textContent = mode === "audio" ? "仅音轨使用当前可取得的最佳音频，无需选择画面清晰度。" : "按源视频实际可用清晰度列出，不放大画面。";
  $("export-hint").textContent = mode === "split" ? "完成后分别下载无声视频与音轨，画面不重新编码。" : mode === "audio" ? "只导出声音；没有独立音频源时需先取得视频文件。" : "清晰度越高，处理时间与文件体积通常越大。";
}
function showAnalysis(data) {
  analysis = data;
  $("video-title").textContent = data.title;
  $("video-source").textContent = data.platform_label;
  $("video-meta").textContent = [data.uploader, duration(data.duration)].filter(Boolean).join(" · ");
  $("quality").replaceChildren(...data.qualities.map((q, i) => { const o = document.createElement("option"); o.value = q.id; o.textContent = `${q.label}${i === 0 ? " · 推荐" : ""}${q.size ? ` · 约 ${bytes(q.size)}` : ""}`; return o; }));
  for (const input of document.querySelectorAll('[name="mode"]')) input.disabled = !data.has_audio && input.value !== "video";
  if (!data.has_audio) document.querySelector('[name="mode"][value="video"]').checked = true;
  $("video-details").hidden = false;
  updateOptions(); controls();
  feedback(data.has_audio ? "解析完成。选择清晰度与保存方式后开始提取。" : "解析完成。此视频没有可取得的音轨，可保存画面。");
}
function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; }
function renderJobs() {
  $("task-count").textContent = `${session.jobs.length} 个任务`;
  $("task-empty").hidden = session.jobs.length > 0;
  $("task-list").replaceChildren(...session.jobs.map((job) => {
    const li = node("li", "task-item");
    const top = node("div", "task-top"); const info = node("div");
    info.append(node("h3", "task-title", job.title || "视频下载"), node("p", "task-meta", [job.platform_label, MODES[job.mode], job.quality_label].filter(Boolean).join(" · ")));
    const cancel = node("button", "text-button", TERMINAL.has(job.state) ? "移除" : "取消"); cancel.type = "button";
    cancel.addEventListener("click", async () => {
      if (TERMINAL.has(job.state)) { session.jobs = session.jobs.filter((j) => j.id !== job.id); persist(); renderJobs(); return; }
      cancel.disabled = true;
      try { const data = await request(`/v1/jobs/${job.id}`, { method: "DELETE" }); Object.assign(job, data); persist(); renderJobs(); }
      catch (e) { feedback(e.message, "error"); cancel.disabled = false; }
    });
    top.append(info, cancel); li.append(top);
    const message = job.connection_error || job.error || `${STAGES[job.state] || "正在处理"}${job.state === "downloading" && Number.isFinite(job.progress) ? ` · ${Math.floor(job.progress)}%` : ""}`;
    li.append(node("p", `task-status${job.state === "error" ? " is-error" : ""}`, message));
    if (!TERMINAL.has(job.state)) { const p = node("progress"); p.max = 100; p.setAttribute("aria-label", `${job.title}：${STAGES[job.state] || "处理中"}`); if (job.state === "downloading" && job.progress != null) p.value = job.progress; li.append(p); }
    if (job.state === "ready") {
      const links = node("div", "artifact-links");
      for (const file of job.files || []) {
        try {
          const url = new URL(file.url, `${apiBase}/`);
          if (url.origin !== new URL(apiBase).origin || !url.pathname.startsWith(`${new URL(apiBase).pathname.replace(/\/$/, "")}/v1/jobs/${job.id}/files/`)) continue;
          const a = node("a", "artifact-link", `${file.label}${file.size ? ` · ${bytes(file.size)}` : ""} ↓`); a.href = url.href; a.referrerPolicy = "no-referrer"; links.append(a);
        } catch { /* A malformed artifact must never become a link. */ }
      }
      li.append(links);
    }
    return li;
  }));
  if (!storageAvailable) $("retention-note").textContent = "本浏览器无法保存任务，关闭页面后需重新提交";
}
async function poll() {
  if (pollActive || !apiBase || !online) return;
  pollActive = true;
  const jobs = session.jobs.filter((j) => !["expired", "cancelled"].includes(j.state));
  await Promise.allSettled(jobs.map(async (job) => {
    try { const data = await request(`/v1/jobs/${job.id}`); if (session.jobs.includes(job)) Object.assign(job, data, { connection_error: "" }); }
    catch (e) {
      if (e.status === 404 || e.status === 410) Object.assign(job, { state: "expired", files: [], error: "结果已过期，请重新提取。", connection_error: "" });
      else job.connection_error = "暂时无法更新进度，恢复连接后会继续查看。";
    }
  }));
  pollActive = false; persist(); renderJobs();
  clearTimeout(pollTimer);
  if (session.jobs.some((j) => !TERMINAL.has(j.state))) pollTimer = setTimeout(poll, document.hidden ? 12000 : 2500);
  else if (session.jobs.some((j) => j.state === "ready" || j.connection_error)) pollTimer = setTimeout(poll, 30000);
}
$("link-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return;
  let url;
  try { url = extractLink($("video-link").value); } catch (e) { feedback(e.message, "error"); $("video-link").focus(); return; }
  if (!online) { feedback(apiBase ? "下载服务暂时不可用，请稍后重试。" : "下载服务尚未启用，暂时无法解析视频。", "error"); return; }
  analysis = null; $("video-details").hidden = true; busy = true; controls(); feedback("正在解析视频与可用清晰度，请稍候…", "busy");
  try { showAnalysis(await request("/v1/analyze", { method: "POST", body: { url }, timeout: 55000 })); }
  catch (e) { feedback(e.message, "error"); }
  finally { busy = false; controls(); }
});
$("reset-button").addEventListener("click", () => { analysis = null; $("video-details").hidden = true; $("video-link").value = ""; feedback(""); controls(); $("video-link").focus(); });
$("video-link").addEventListener("input", () => { if (analysis) { analysis = null; $("video-details").hidden = true; controls(); } });
for (const radio of document.querySelectorAll('[name="mode"]')) radio.addEventListener("change", updateOptions);
$("download-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!analysis || busy || !online) return;
  if (session.jobs.length >= 10) { feedback("请先移除已完成的任务，再添加新下载。", "error"); return; }
  busy = true; controls(); feedback("正在添加下载任务…", "busy");
  try {
    const job = await request("/v1/jobs", { method: "POST", body: { analysis_id: analysis.id, quality_id: $("quality").value, mode: document.querySelector('[name="mode"]:checked').value, audio_format: $("audio-format").value } });
    session.jobs.unshift(job); persist(); renderJobs(); feedback("已加入下载任务。处理完成后，点击文件保存。"); clearTimeout(pollTimer); poll();
  } catch (e) { feedback(e.message, "error"); }
  finally { busy = false; controls(); }
});
async function checkService() {
  clearTimeout(healthTimer);
  if (!apiBase) { $("service-state").textContent = "下载服务尚未启用"; feedback("页面已就绪，下载服务部署完成后开放使用。"); controls(); return; }
  try {
    const health = await request("/v1/health");
    online = health.status === "ready";
    $("service-state").textContent = online ? "服务已连接" : "服务正在维护";
    $("service-state").dataset.ready = String(online);
    if (!online) feedback("下载服务正在维护，请稍后重试。", "error");
    else { $("retention-note").textContent = `结果暂存 ${health.retention_minutes} 分钟`; poll(); }
  } catch (e) { online = false; $("service-state").textContent = "服务暂时无法连接"; feedback(e.message, "error"); }
  controls();
  healthTimer = setTimeout(checkService, online ? 120000 : 30000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { clearTimeout(pollTimer); checkService(); } });
window.addEventListener("online", checkService);
updateOptions(); renderJobs(); controls(); checkService();
