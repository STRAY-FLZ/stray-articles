const $ = (selector) => document.querySelector(selector);
const items = [];
const scriptCache = new Map();
let running = false;
let nextId = 0;
let previewItem = null;
let previewVersion = 'original';
let previewGeneration = 0;
const vendor = new URL('vendor/', import.meta.url);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 12;
const MAX_PDF_PAGES = 60;

function announce(message) { $('#announcement').textContent = message; }
function loadScript(name) {
  if (!scriptCache.has(name)) {
    scriptCache.set(name, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(name, vendor).href;
      script.onload = resolve;
      script.onerror = () => { script.remove(); scriptCache.delete(name); reject(new Error('转换组件加载失败，请刷新页面后重试。')); };
      document.head.append(script);
    }));
  }
  return scriptCache.get(name);
}
let pdfLibrary;
async function getPdfLibrary() {
  if (!pdfLibrary) {
    pdfLibrary = import(new URL('pdf.mjs', vendor).href).then((library) => {
      library.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', vendor).href;
      return library;
    }).catch(() => { pdfLibrary = null; throw new Error('PDF 组件加载失败，请刷新页面后重试。'); });
  }
  return pdfLibrary;
}
async function openPdf(buffer) {
  const library = await getPdfLibrary();
  const loading = library.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false,
    cMapUrl: new URL('cmaps/', vendor).href, cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', vendor).href,
    wasmUrl: new URL('wasm/', vendor).href,
  });
  // Password entry is intentionally deferred; encrypted files get a clear error.
  loading.onPassword = () => { loading.destroy(); };
  try { return await loading.promise; }
  catch (error) {
    await loading.destroy();
    if (/password|destroyed/i.test(error.message)) throw new Error('暂不支持加密 PDF，请先移除密码后重试。');
    throw new Error('无法读取 PDF，请检查文件是否损坏，或是否为有效的 PDF 文档。');
  }
}
function bytesLabel(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function outputName(file, extension) { return file.name.replace(/\.[^.]+$/, '') + '.' + extension; }
function setStatus(item, message) { item.message = message; renderList(); }

function renderList() {
  $('#file-count').textContent = items.length;
  $('#empty-state').hidden = items.length > 0;
  $('#clear-button').disabled = items.length === 0 || running || items.some((item) => item.state === 'queued');
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.id = item.id;
    const icon = document.createElement('span');
    icon.className = `file-type ${item.kind}`;
    icon.textContent = item.kind === 'pdf' ? 'PDF' : 'W';
    icon.setAttribute('aria-hidden', 'true');
    const info = document.createElement('div');
    const name = document.createElement('p');
    name.className = 'file-name'; name.textContent = item.file.name;
    const status = document.createElement('div');
    status.className = `file-status ${item.state}`;
    const target = item.kind === 'pdf' ? 'Word' : 'PDF';
    status.textContent = `${bytesLabel(item.file.size)} · ${item.kind === 'pdf' ? 'PDF' : 'Word'} → ${target} · ${item.message}`;
    info.append(name, status);
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const button = (text, action, className = '') => {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
      node.dataset.action = action; node.className = className;
      node.setAttribute('aria-label', `${text}：${item.file.name}`);
      actions.append(node); return node;
    };
    button('预览', 'preview').disabled = item.state !== 'ready';
    if (item.state === 'error') button('重试', 'retry');
    else button('下载', 'download', 'download-button').disabled = item.state !== 'ready';
    button('×', 'remove', 'remove-button').setAttribute('aria-label', `移除：${item.file.name}`);
    actions.lastChild.disabled = ['processing', 'queued'].includes(item.state);
    row.append(icon, info, actions); fragment.append(row);
  }
  $('#file-list').replaceChildren(fragment);
}

function addFiles(files, kind) {
  let added = 0;
  const errors = [];
  for (const file of files) {
    const extension = kind === 'pdf' ? /\.pdf$/i : /\.docx$/i;
    if (!extension.test(file.name)) { errors.push(`${file.name}：请选择 ${kind === 'pdf' ? '.pdf' : '.docx'} 文件${/\.doc$/i.test(file.name) ? '，旧版 .doc 请先另存为 .docx' : ''}。`); continue; }
    if (!file.size) { errors.push(`${file.name}：文件为空。`); continue; }
    if (file.size > MAX_BYTES) { errors.push(`${file.name}：超过 20 MB，请压缩或拆分后重试。`); continue; }
    if (items.length >= MAX_FILES) { errors.push('列表最多保留 12 个文件，请移除部分文件后再添加。'); break; }
    if (items.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) {
      errors.push(`${file.name} 已在列表中。`); continue;
    }
    items.push({ id: ++nextId, file, kind, mode: $('#pdf-mode').value, state: 'queued', message: '等待转换', result: null, html: null });
    added++;
  }
  announce([added ? `已添加 ${added} 个文件，正在本地转换。` : '', ...errors].filter(Boolean).join(' '));
  renderList();
  if (added) processQueue();
}

async function processQueue() {
  if (running) return;
  running = true;
  renderList();
  try {
    let item;
    while ((item = items.find((entry) => entry.state === 'queued'))) {
      item.state = 'processing'; setStatus(item, '正在读取文件…');
      try {
        if (item.kind === 'pdf') await pdfToWord(item);
        else await wordToPdf(item);
        item.state = 'ready';
      } catch (error) {
        item.state = 'error';
        item.message = error.message || '转换未完成，请检查文件后重试。';
        item.result = null;
      }
      renderList();
    }
  } finally {
    running = false; renderList();
    const ready = items.filter((item) => item.state === 'ready').length;
    const failed = items.filter((item) => item.state === 'error').length;
    if (items.length) announce(`本地处理完成：${ready} 个文件已就绪${failed ? `，${failed} 个文件未完成，请查看提示` : '，可预览或下载'}。`);
  }
}

function pdfLines(content) {
  const lines = [];
  const textItems = content.items.filter((entry) => entry.str?.trim());
  textItems.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  for (const entry of textItems) {
    const y = entry.transform[5];
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - y) > Math.max(2, (entry.height || 10) * .35)) {
      line = { y, entries: [] }; lines.push(line);
    }
    line.entries.push(entry);
  }
  return lines.map((line) => {
    line.entries.sort((a, b) => a.transform[4] - b.transform[4]);
    return line.entries.map((entry, index) => {
      const previous = line.entries[index - 1];
      const gap = previous ? entry.transform[4] - (previous.transform[4] + previous.width) : 0;
      return { text: (gap > 2 ? ' ' : '') + entry.str, size: Math.max(16, Math.min(60, Math.round((entry.height || Math.hypot(entry.transform[0], entry.transform[1]) || 11) * 2))), bold: /bold|black/i.test(entry.fontName) };
    });
  });
}
async function renderPage(page, scale = 1.5) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  if (canvas.width * canvas.height > 20000000) throw new Error('PDF 页面尺寸过大，请先缩小页面后重试。');
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}
async function pdfToWord(item) {
  await loadScript('docx.js');
  const { Document, Packer, Paragraph, TextRun, ImageRun } = window.docx;
  const pdf = await openPdf(await item.file.arrayBuffer());
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error('初版支持最多 60 页 PDF，请拆分后重试。');
    const sections = [];
    let imagePages = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      setStatus(item, `正在转换第 ${number} / ${pdf.numPages} 页…`);
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      if (viewport.width < 90 || viewport.height < 90 || viewport.width > 3000 || viewport.height > 3000) throw new Error('PDF 页面尺寸超出初版支持范围，请调整页面尺寸后重试。');
      const lines = item.mode === 'text' ? pdfLines(await page.getTextContent()) : [];
      let children;
      if (!lines.length) {
        const canvas = await renderPage(page);
        const data = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))).arrayBuffer());
        const ratio = Math.min((viewport.width - 56) * 96 / 72 / canvas.width, (viewport.height - 62) * 96 / 72 / canvas.height);
        children = [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ type: 'png', data, transformation: { width: canvas.width * ratio, height: canvas.height * ratio } })] })];
        canvas.width = canvas.height = 0;
        imagePages++;
      } else {
        children = lines.map((line) => new Paragraph({ spacing: { after: 70 }, children: line.map((part) => new TextRun({ ...part, font: 'Microsoft YaHei' })) }));
      }
      sections.push({ properties: { page: { size: { width: Math.round(viewport.width * 20), height: Math.round(viewport.height * 20) }, margin: { top: 560, bottom: 560, left: 560, right: 560 } } }, children });
      page.cleanup();
    }
    setStatus(item, '正在生成 Word 文件…');
    item.result = await Packer.toBlob(new Document({ sections }));
    item.outputName = outputName(item.file, 'docx');
    item.message = `转换完成 · ${pdf.numPages} 页${imagePages ? ` · ${imagePages} 页保留为图片` : ' · 可编辑文字'}`;
  } finally { await pdf.loadingTask.destroy(); }
}

async function wordHtml(buffer) {
  await Promise.all([loadScript('mammoth.js'), loadScript('purify.js')]);
  let conversion;
  try { conversion = await window.mammoth.convertToHtml({ arrayBuffer: buffer }); }
  catch { throw new Error('无法读取 Word，请检查文件是否损坏、加密，或是否为有效的 .docx 文档。'); }
  const safe = window.DOMPurify.sanitize(conversion.value, {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'blockquote', 'pre', 'span', 'hr', 'a'],
    ALLOWED_ATTR: ['src', 'alt', 'colspan', 'rowspan'],
  });
  const documentHtml = document.createElement('div');
  documentHtml.innerHTML = safe;
  for (const image of documentHtml.querySelectorAll('img')) {
    if (!/^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(image.getAttribute('src') || '')) image.remove();
  }
  if (!documentHtml.textContent.trim() && !documentHtml.querySelector('img')) throw new Error('未找到可转换的文字或图片，请检查文档内容。');
  return { html: documentHtml.innerHTML, warnings: conversion.messages.length };
}
const exportStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #222; }
  .export-page { width: 698px; padding: 0; color: #222; background: #fff; font: 15px/1.75 'Microsoft YaHei', Arial, sans-serif; overflow-wrap: anywhere; }
  h1 { font-size: 28px; line-height: 1.4; } h2 { font-size: 23px; } h3 { font-size: 19px; }
  p { margin: 0 0 14px; } img { max-width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 14px 0; }
  td, th { border: 1px solid #bbb; padding: 7px; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; } blockquote { margin-left: 20px; border-left: 2px solid #aaa; padding-left: 14px; }
`;
async function wordToPdf(item) {
  setStatus(item, '正在读取 Word 内容…');
  const parsed = await wordHtml(await item.file.arrayBuffer());
  item.html = parsed.html;
  await loadScript('html2pdf.js');
  // An isolated iframe keeps the blog theme and styles out of exported documents.
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:800px;height:1100px;border:0;';
  document.body.append(frame);
  try {
    const targetDoc = frame.contentDocument;
    const style = targetDoc.createElement('style'); style.textContent = exportStyles;
    targetDoc.head.append(style);
    const content = targetDoc.createElement('div'); content.className = 'export-page'; content.innerHTML = parsed.html;
    targetDoc.body.append(content);
    await targetDoc.fonts.ready;
    await Promise.all(Array.from(content.querySelectorAll('img'), (image) => image.decode().catch(() => { throw new Error('文档包含无法读取的图片，请检查后重试。'); })));
    if (content.scrollHeight > 20000) throw new Error('Word 内容过长，初版建议拆分为约 20 页以内后重试。');
    // html2pdf clones into the parent document; carry iframe styles with the nodes.
    const styleProperties = ['display', 'box-sizing', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'margin', 'padding', 'border', 'text-align', 'text-decoration', 'vertical-align', 'max-width', 'table-layout', 'border-collapse', 'list-style-type', 'white-space', 'overflow-wrap'];
    for (const element of [content, ...content.querySelectorAll('*')]) {
      const computed = frame.contentWindow.getComputedStyle(element);
      for (const property of styleProperties) element.style.setProperty(property, computed.getPropertyValue(property));
      if (element.tagName === 'TABLE') element.style.width = '100%';
    }
    content.style.width = '698px';
    setStatus(item, '正在排版并生成 PDF…');
    item.result = await window.html2pdf().set({
      margin: 12, filename: outputName(item.file, 'pdf'),
      image: { type: 'jpeg', quality: .96 },
      html2canvas: { scale: Math.min(2, 24000 / Math.max(1, content.scrollHeight)), backgroundColor: '#ffffff', logging: false, useCORS: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'img'] },
    }).from(content).outputPdf('blob');
    if (!item.result?.size) throw new Error('未能生成 PDF，请缩小文档后重试。');
    item.outputName = outputName(item.file, 'pdf');
    item.message = `转换完成 · A4 PDF${parsed.warnings ? ' · 部分样式已简化，请预览确认' : ' · 请预览确认排版'}`;
  } finally { frame.remove(); }
}

function download(item) {
  if (!item.result) return;
  const url = URL.createObjectURL(item.result);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.outputName;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function displayPreview() {
  const generation = ++previewGeneration;
  const item = previewItem;
  if (!item) return;
  const original = previewVersion === 'original';
  $('#original-tab').setAttribute('aria-pressed', String(original));
  $('#result-tab').setAttribute('aria-pressed', String(!original));
  $('#preview-title').textContent = original ? item.file.name : item.outputName;
  const content = $('#preview-content'); content.replaceChildren(); content.setAttribute('aria-busy', 'true');
  const loadingMessage = document.createElement('p'); loadingMessage.className = 'preview-message'; loadingMessage.textContent = '正在准备预览…'; content.append(loadingMessage);
  $('#preview-caption').textContent = '';
  const file = original ? item.file : item.result;
  const isPdf = original ? item.kind === 'pdf' : item.kind === 'word';
  let pdf;
  try {
    if (isPdf) {
      pdf = await openPdf(await file.arrayBuffer());
      if (generation !== previewGeneration) return;
      content.replaceChildren();
      const pages = Math.min(pdf.numPages, 5);
      $('#preview-caption').textContent = `共 ${pdf.numPages} 页${pdf.numPages > 5 ? ' · 预览前 5 页' : ''}`;
      for (let number = 1; number <= pages; number++) {
        const canvas = await renderPage(await pdf.getPage(number), 1.2);
        if (generation !== previewGeneration) return;
        canvas.setAttribute('aria-label', `第 ${number} 页`); content.append(canvas);
      }
    } else {
      const html = original && item.html ? item.html : (await wordHtml(await file.arrayBuffer())).html;
      if (generation !== previewGeneration) return;
      const page = document.createElement('div'); page.className = 'word-preview'; page.innerHTML = html;
      content.replaceChildren(page);
      $('#preview-caption').textContent = '内容预览 · 实际版式请以 Word 打开为准';
    }
  } catch (error) {
    if (generation !== previewGeneration) return;
    loadingMessage.textContent = error.message; content.replaceChildren(loadingMessage);
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
    if (generation === previewGeneration) content.setAttribute('aria-busy', 'false');
  }
}

for (const kind of ['pdf', 'word']) {
  const input = $(`#${kind}-input`);
  input.addEventListener('change', () => { addFiles(Array.from(input.files), kind); input.value = ''; });
  const card = $(`[data-drop="${kind}"]`);
  let dragDepth = 0;
  card.addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth++; card.classList.add('is-dragging'); });
  card.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  card.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; card.classList.remove('is-dragging'); } });
  card.addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; card.classList.remove('is-dragging'); addFiles(Array.from(event.dataTransfer.files), kind); });
}
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
$('#file-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const item = items.find((entry) => String(entry.id) === button.closest('.file-row').dataset.id);
  if (!item) return;
  switch (button.dataset.action) {
    case 'download': download(item); break;
    case 'preview': previewItem = item; previewVersion = 'original'; $('#preview-dialog').showModal(); displayPreview(); break;
    case 'retry': item.state = 'queued'; item.message = '等待重试'; renderList(); processQueue(); break;
    case 'remove': items.splice(items.indexOf(item), 1); renderList(); break;
  }
});
$('#clear-button').addEventListener('click', () => { if (running) return; items.length = 0; announce('文件列表已清空。'); renderList(); });
$('#close-preview').addEventListener('click', () => $('#preview-dialog').close());
$('#preview-dialog').addEventListener('close', () => { previewGeneration++; previewItem = null; $('#preview-content').replaceChildren(); });
$('#preview-dialog').addEventListener('click', (event) => { if (event.target === $('#preview-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('#original-tab').addEventListener('click', () => { previewVersion = 'original'; displayPreview(); });
$('#result-tab').addEventListener('click', () => { previewVersion = 'result'; displayPreview(); });
$('#sample-button').addEventListener('click', async () => {
  const button = $('#sample-button'); button.disabled = true;
  try {
    if (items.length >= MAX_FILES) throw new Error('请先移除部分文件，再试用示例。');
    await loadScript('docx.js');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = window.docx;
    const sample = new Document({ sections: [{ children: [
      new Paragraph({ text: '让文档继续流转', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: 'Stray · PDF ⇄ Word', bold: true })] }),
      new Paragraph('这是一份示例文档。你可以先预览原文件，再查看转换后的 PDF，并下载保存。'),
      new Paragraph('在学习和生活里，一份资料可能需要不同的格式。把重复的步骤交给小工具，让时间留给更有趣的事。'),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [['格式', '适合的场景'], ['Word', '编辑文字与整理内容'], ['PDF', '阅读、分享与保存']].map((row) => new TableRow({ children: row.map((text) => new TableCell({ children: [new Paragraph(text)] })) })) }),
      new Paragraph('文件在浏览器本地处理，不会上传到服务器。'),
    ] }] });
    const blob = await Packer.toBlob(sample);
    addFiles([new File([blob], 'Stray-示例文档.docx', { type: blob.type, lastModified: 0 })], 'word');
  } catch (error) { announce(error.message); }
  finally { button.disabled = false; }
});
renderList();
