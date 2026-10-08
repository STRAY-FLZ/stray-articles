import { escape, button, collectionOptions, download } from "./ui.mjs";
import { EXPORT_SPEC, DEMO_TEXT } from "./export-spec.mjs";
import { parseVocabulary } from "./parser.mjs";
import { stableId } from "./model.mjs";
export async function render(ctx) {
  let parsed = null,
    filename = "",
    fileHash = "",
    busy = false;
  ctx.mount(`<div class="page-title"><h1>导入个人词库</h1><a href="#library">返回我的词库 →</a></div><section class="panel"><p>支持结构化 TXT、Markdown、JSON 和 JSON Lines。每个词义需包含词性及配对的中英文释义。不会自动补写缺失资料。</p><label>目标词库<select id="import-collection">${collectionOptions(ctx.collections, ctx.prefs.collectionId)}</select></label><label>上传词汇文件<input type="file" id="vocab-file" accept=".txt,.json,.jsonl,.md,text/plain,application/json"></label><p class="muted small">建议不超过 50 MB；大文件在 Web Worker 中解析，分批保存。</p><div class="actions">${button("下载教学演示 TXT", "demo-download")}${button("预览教学演示数据", "demo-preview")}</div><p class="muted small">演示内容为原创教学数据，非词典原文或真实考试题目。</p><div id="import-progress" role="status"></div><div id="import-preview"></div></section>
 <details class="panel"><summary>GLM 导出规范（可复制，含三个示例）</summary><p>优先使用 JSON Lines，每行一个完整词条，保存为 UTF-8 .txt。</p>${button("复制完整导出规范", "copy-spec")}<textarea id="export-spec" readonly rows="20" aria-label="GLM 导出规范">${escape(EXPORT_SPEC)}</textarea></details>`);
  const progress = (message) => {
    if (ctx.alive())
      document.getElementById("import-progress").textContent = message;
  };
  async function preview(text, name) {
    if (busy) return;
    busy = true;
    filename = name;
    fileHash = stableId(text);
    progress("正在解析文件…");
    try {
      if (typeof Worker !== "undefined") {
        const worker = new Worker(
          new URL("./import-worker.mjs", import.meta.url),
          { type: "module" },
        );
        parsed = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(Error("解析超时，请分批导入"));
          }, 120000);
          worker.onmessage = ({ data }) => {
            if (data.type === "progress")
              progress(`已校验 ${data.done} / ${data.total} 条记录`);
            else {
              clearTimeout(timeout);
              worker.terminate();
              data.type === "result"
                ? resolve(data.result)
                : reject(Error(data.message));
            }
          };
          worker.onerror = () => {
            clearTimeout(timeout);
            worker.terminate();
            reject(Error("后台解析器无法启动，请检查静态资源是否完整"));
          };
          worker.postMessage({ text });
        });
      } else {
        if (text.length > 1024 * 1024)
          throw Error("当前浏览器不支持后台解析，请将文件拆分至 1 MB 以下");
        parsed = parseVocabulary(text);
      }
      const p = await ctx.store.previewImport(parsed.records);
      if (!ctx.alive()) return;
      document.getElementById("import-preview").innerHTML =
        `<h2>导入预览</h2><p>${escape(parsed.format)} · ${parsed.records.length} 条可导入 · ${p.newWords} 条新词 · ${p.duplicated} 条已有词 · ${p.newSenses} 个新增词义 · ${parsed.failed || 0} 条失败</p><p>仅保存有效词义。相同内容保留原有标识与学习进度；不同释义或来源作为独立词义保留。</p><label>重复词处理<select id="import-mode"><option value="merge">合并词义与标签，保留进度</option><option value="skip">跳过已有词</option></select></label><ul class="preview-list">${parsed.records
          .slice(0, 5)
          .map(
            (w) =>
              `<li><strong>${escape(w.word)}</strong> · ${w.senses.length} 个词义 · ${escape(w.senses.map((s) => s.definitionZH).join(" / "))}</li>`,
          )
          .join(
            "",
          )}</ul>${issuesHtml(parsed.issues)}<div class="actions">${button("下载完整校验报告", "issues-download")}${button("确认保存有效词条", "import-save", `class="primary" ${parsed.records.length ? "" : "disabled"}`)}</div>`;
      progress("预览已就绪，确认后才写入词库。");
    } catch (e) {
      ctx.notice(e.message, true);
    } finally {
      busy = false;
    }
  }
  ctx.on("change", "#vocab-file", async (_, node) => {
    const file = node.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      ctx.notice("文件超过 50 MB，请拆分导入", true);
      return;
    }
    await preview(await file.text(), file.name);
  });
  ctx.on("click", "[data-action]", async (_, node) => {
    const action = node.dataset.action;
    if (action === "demo-download")
      download(DEMO_TEXT, "vocabulary-demonstration.txt", "text/plain");
    if (action === "demo-preview") await preview(DEMO_TEXT, "原创教学演示.txt");
    if (action === "copy-spec") {
      try {
        await navigator.clipboard.writeText(EXPORT_SPEC);
        ctx.notice("已复制 GLM 导出规范");
      } catch {
        document.getElementById("export-spec").select();
        ctx.notice("浏览器未允许复制，已选中文本，请手动复制");
      }
    }
    if (action === "issues-download")
      download(
        {
          file: filename,
          format: parsed?.format,
          issues: parsed?.issues || [],
        },
        "vocabulary-validation.json",
      );
    if (action === "import-save" && parsed && !busy) {
      busy = true;
      node.disabled = true;
      try {
        const c = document.getElementById("import-collection").value,
          mode = document.getElementById("import-mode").value;
        const r = await ctx.store.importRecords(
          parsed.records,
          c,
          mode,
          { filename, fileHash, format: parsed.format },
          (p) => progress(`正在保存 ${p.done} / ${p.total} 条`),
        );
        progress(
          `导入完成：新增 ${r.imported}，合并 ${r.merged}，重复 ${r.duplicated}，跳过 ${r.skipped}，保存失败 ${r.failed}；解析失败 ${parsed.failed || 0}。`,
        );
        if (r.issues.length && ctx.alive())
          document
            .getElementById("import-preview")
            .insertAdjacentHTML("beforeend", issuesHtml(r.issues));
        ctx.notice("有效词条已保存，已有学习进度保留");
      } finally {
        busy = false;
      }
    }
  });
}
function issuesHtml(issues) {
  return issues.length
    ? `<details><summary>校验问题（${issues.length} 条）</summary><ul class="issue-list">${issues
        .slice(0, 100)
        .map(
          (i) =>
            `<li>${escape(i.location)} · ${i.severity === "error" ? "错误" : "提示"}：${escape(i.message)}</li>`,
        )
        .join(
          "",
        )}</ul>${issues.length > 100 ? "<p>仅显示前 100 条，请下载完整报告查看其余问题。</p>" : ""}</details>`
    : "<p>未发现校验问题。</p>";
}
