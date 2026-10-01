import { createLayoutDocument, layoutPreview } from './pdf-layout.js?v=20261001-layout';

const $ = (selector) => document.querySelector(selector);
const items = [];
const scriptCache = new Map();
let running = false;
let nextId = 0;
let previewItem = null;
let previewVersion = 'original';
let previewGeneration = 0;
const previewImageUrls = [];
const vendor = new URL('vendor/', import.meta.url);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 12;
const MAX_PDF_PAGES = 60;
const MAX_IMAGES = 12;
const MAX_IMAGE_PIXELS = 40_000_000;
const imageExtension = /\.(jpe?g|png|webp)$/i;

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
function itemName(item) { return item.displayName || item.file.name; }
function clearPreviewImages() { for (const url of previewImageUrls.splice(0)) URL.revokeObjectURL(url); }
function layoutBusy(item) { return ['queued', 'processing'].includes(item.layoutState); }
function syncPreviewTabs(item) {
  $('#original-tab').textContent = item.kind === 'pdf' ? '原 PDF' : '原文件';
  $('#layout-tab').hidden = !item.layoutResult;
}

function renderList() {
  $('#file-count').textContent = items.length;
  $('#empty-state').hidden = items.length > 0;
  $('#clear-button').disabled = items.length === 0 || running || items.some((item) => item.state === 'queued' || layoutBusy(item));
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.id = item.id;
    const icon = document.createElement('span');
    icon.className = `file-type ${item.kind}`;
    icon.textContent = item.kind === 'pdf' ? 'PDF' : item.kind === 'image' ? 'IMG' : 'W';
    icon.setAttribute('aria-hidden', 'true');
    const info = document.createElement('div');
    const name = document.createElement('p');
    name.className = 'file-name'; name.textContent = itemName(item);
    const status = document.createElement('div');
    status.className = `file-status ${layoutBusy(item) ? 'processing' : item.layoutState === 'error' ? 'error' : item.state}`;
    const target = item.kind === 'pdf' ? 'Word' : 'PDF';
    const source = item.kind === 'pdf' ? 'PDF' : item.kind === 'image' ? '图片' : 'Word';
    status.textContent = `${bytesLabel(item.totalBytes ?? item.file.size)} · ${source} → ${target} · ${item.layoutMessage || item.message}`;
    info.append(name, status);
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const button = (text, action, className = '') => {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
      node.dataset.action = action; node.className = className;
      node.setAttribute('aria-label', `${text}：${itemName(item)}`);
      actions.append(node); return node;
    };
    button('预览', 'preview').disabled = item.state !== 'ready';
    if (item.state === 'error') button('重试', 'retry');
    else button('下载', 'download', 'download-button').disabled = item.state !== 'ready';
    if (item.kind === 'pdf') {
      if (item.layoutResult) {
        button('排版预览', 'preview-layout');
        button('下载排版', 'download-layout', 'layout-button');
      } else {
        button(layoutBusy(item) ? '排版中…' : item.layoutState === 'error' ? '重试排版' : '一键排版', 'layout', 'layout-button').disabled = item.state !== 'ready' || layoutBusy(item);
      }
    }
    button('×', 'remove', 'remove-button').setAttribute('aria-label', `移除：${itemName(item)}`);
    actions.lastChild.disabled = ['processing', 'queued'].includes(item.state) || layoutBusy(item);
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
    if (items.some((item) => item.kind === kind && item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) {
      errors.push(`${file.name} 已在列表中。`); continue;
    }
    items.push({ id: ++nextId, file, kind, mode: $('#pdf-mode').value, state: 'queued', message: '等待转换', result: null, html: null });
    added++;
  }
  announce([added ? `已添加 ${added} 个文件，正在本地转换。` : '', ...errors].filter(Boolean).join(' '));
  renderList();
  if (added) processQueue();
}

function addImages(files) {
  if (!files.length) return;
  const errors = [];
  if (files.length > MAX_IMAGES) errors.push('一次最多选择 12 张图片，请分批制作。');
  if (items.length >= MAX_FILES) errors.push('列表最多保留 12 个任务，请移除部分任务后再添加。');
  for (const file of files) {
    if (!imageExtension.test(file.name)) errors.push(`${file.name}：请选择 JPG、PNG 或 WebP 图片。`);
    else if (!file.size) errors.push(`${file.name}：文件为空。`);
    else if (file.size > MAX_BYTES) errors.push(`${file.name}：超过 20 MB，请压缩后重试。`);
  }
  // Reject the whole selection on validation errors so no page is silently omitted.
  if (errors.length) { announce(`${errors.join(' ')} 本次未生成 PDF，请调整后重新选择。`); return; }
  const signature = JSON.stringify(files.map((file) => [file.name, file.size, file.lastModified]));
  if (items.some((item) => item.kind === 'image' && item.signature === signature)) {
    announce('这组图片已在列表中，可直接预览、下载或移除后重新添加。'); return;
  }
  items.push({
    id: ++nextId, file: files[0], images: files, kind: 'image', signature,
    displayName: files.length === 1 ? files[0].name : `${files[0].name} 等 ${files.length} 张图片`,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    state: 'queued', message: '等待制作 PDF', result: null, html: null,
  });
  announce(`已添加 ${files.length} 张图片，正在本地合成 PDF。`);
  renderList(); processQueue();
}

async function processQueue() {
  if (running) return;
  running = true;
  renderList();
  try {
    let item;
    while ((item = items.find((entry) => entry.state === 'queued' || entry.layoutState === 'queued'))) {
      if (item.layoutState === 'queued' && item.state === 'ready') {
        item.layoutState = 'processing';
        try {
          await loadScript('docx.js');
          const layout = await createLayoutDocument(item.file, {
            openPdf, getPdfLibrary,
            onProgress: (message) => { item.layoutMessage = message; renderList(); },
          });
          item.layoutResult = layout.result; item.layout = layout;
          item.layoutOutputName = outputName(item.file, 'docx').replace(/\.docx$/, '-排版.docx');
          item.layoutState = 'ready';
          item.layoutMessage = `排版完成 · ${layout.totalPages} 页 · ${layout.imagePages ? `${layout.imagePages} 页按图像保留（不可编辑）` : '文字可编辑，图片与图形保留'}`;
          if (previewItem === item) syncPreviewTabs(item);
          announce('一键排版完成，可查看“排版预览”或下载排版后的 DOCX；原转换文件仍保留。');
        } catch (error) {
          item.layoutState = 'error';
          item.layoutMessage = `排版未完成：${error.message || '请重试'}；原转换文件仍可下载。`;
          announce(item.layoutMessage);
        }
        renderList(); continue;
      }
      item.state = 'processing'; setStatus(item, '正在读取文件…');
      try {
        if (item.kind === 'pdf') await pdfToWord(item);
        else if (item.kind === 'image') await imagesToPdf(item);
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
    const layoutFailed = items.filter((item) => item.layoutState === 'error').length;
    if (items.length) announce(`本地处理完成：${ready} 个文件已就绪${failed ? `，${failed} 个文件未完成，请查看提示` : '，可预览或下载'}${layoutFailed ? `；${layoutFailed} 个排版任务未完成，原转换文件仍保留` : ''}。`);
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

async function imagePage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  let canvas;
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片没有有效尺寸');
    if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error(`${file.name}：超过 4,000 万像素，请缩小图片后重试。`);
    }
    // A4 at roughly 200 dpi. Render one page at a time to keep memory bounded.
    canvas = document.createElement('canvas');
    canvas.width = 1654;
    canvas.height = Math.floor(canvas.width * 297 / 210);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片页面，请关闭部分浏览器标签后重试。');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    const margin = canvas.width * 12 / 210;
    const scale = Math.min((canvas.width - margin * 2) / image.naturalWidth, (canvas.height - margin * 2) / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas;
  } catch (error) {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (error.message.includes('重试')) throw error;
    throw new Error(`${file.name}：无法读取图片，请检查是否损坏或改用 JPG、PNG、WebP。`);
  } finally { URL.revokeObjectURL(url); image.src = ''; }
}

async function imagesToPdf(item) {
  await loadScript('html2pdf.js');
  let pdf;
  for (let index = 0; index < item.images.length; index++) {
    setStatus(item, `正在制作第 ${index + 1} / ${item.images.length} 页…`);
    const canvas = await imagePage(item.images[index]);
    try {
      if (!pdf) {
        // Reuse html2pdf's bundled jsPDF; images never leave the browser.
        pdf = await window.html2pdf().set({
          margin: 0, image: { type: 'jpeg', quality: .96 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        }).from(canvas, 'canvas').toPdf().get('pdf');
      } else {
        pdf.addPage('a4', 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', .96), 'JPEG', 0, 0, 210, 297);
      }
    } finally { canvas.width = 0; canvas.height = 0; }
    // Let the progress indicator repaint between pages.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  item.result = pdf.output('blob');
  if (!item.result?.size) throw new Error('未能生成 PDF，请缩小图片后重试。');
  item.outputName = item.images.length === 1 ? outputName(item.file, 'pdf') : outputName(item.file, 'pdf').replace(/\.pdf$/, '-图片合集.pdf');
  item.message = `制作完成 · ${item.images.length} 页 A4 PDF · 每张一页，保持比例`;
}

function download(item, formatted = false) {
  const result = formatted ? item.layoutResult : item.result;
  if (!result) return;
  const url = URL.createObjectURL(result);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = formatted ? item.layoutOutputName : item.outputName;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function displayPreview() {
  const generation = ++previewGeneration;
  clearPreviewImages();
  const item = previewItem;
  if (!item) return;
  syncPreviewTabs(item);
  const original = previewVersion === 'original';
  const formatted = previewVersion === 'layout';
  $('#original-tab').setAttribute('aria-pressed', String(original));
  $('#result-tab').setAttribute('aria-pressed', String(!original && !formatted));
  $('#layout-tab').setAttribute('aria-pressed', String(formatted));
  $('#preview-title').textContent = formatted ? item.layoutOutputName : original ? itemName(item) : item.outputName;
  const content = $('#preview-content'); content.replaceChildren(); content.setAttribute('aria-busy', 'true');
  const loadingMessage = document.createElement('p'); loadingMessage.className = 'preview-message'; loadingMessage.textContent = '正在准备预览…'; content.append(loadingMessage);
  $('#preview-caption').textContent = '';
  const file = original ? item.file : item.result;
  const isPdf = original ? item.kind === 'pdf' : item.kind !== 'pdf';
  let pdf;
  try {
    if (formatted) {
      if (!item.layoutResult) throw new Error('请先完成一键排版，再查看排版结果。');
      content.replaceChildren(layoutPreview(item.layout, (blob) => {
        const url = URL.createObjectURL(blob); previewImageUrls.push(url); return url;
      }));
      $('#preview-caption').textContent = `共 ${item.layout.totalPages} 页${item.layout.totalPages > 5 ? ' · 预览前 5 页' : ''} · 排版示意，Word 中可能有差异`;
    } else if (original && item.kind === 'image') {
      const fragment = document.createDocumentFragment();
      for (const [index, file] of item.images.entries()) {
        const figure = document.createElement('figure'); figure.className = 'image-preview';
        const image = document.createElement('img'); image.alt = `第 ${index + 1} 张：${file.name}`;
        image.src = URL.createObjectURL(file); previewImageUrls.push(image.src);
        const caption = document.createElement('figcaption'); caption.textContent = `${index + 1}. ${file.name}`;
        figure.append(image, caption); fragment.append(figure);
      }
      content.replaceChildren(fragment);
      $('#preview-caption').textContent = `共 ${item.images.length} 张图片 · 按选择顺序`;
    } else if (isPdf) {
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

$('#select-pdf-button').addEventListener('click', () => $('#pdf-input').click());
$('#select-images-button').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', () => {
  const input = $('#image-input'); addImages(Array.from(input.files)); input.value = '';
});
for (const kind of ['pdf', 'word']) {
  const input = $(`#${kind}-input`);
  input.addEventListener('change', () => { addFiles(Array.from(input.files), kind); input.value = ''; });
  const card = $(`[data-drop="${kind}"]`);
  let dragDepth = 0;
  card.addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth++; card.classList.add('is-dragging'); });
  card.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  card.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; card.classList.remove('is-dragging'); } });
  card.addEventListener('drop', (event) => {
    event.preventDefault(); dragDepth = 0; card.classList.remove('is-dragging');
    const files = Array.from(event.dataTransfer.files);
    if (kind === 'pdf' && files.some((file) => imageExtension.test(file.name))) {
      if (files.some((file) => /\.pdf$/i.test(file.name))) announce('PDF 和图片请分开添加，以便确定图片的合并顺序。');
      else addImages(files);
    } else addFiles(files, kind);
  });
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
    case 'download-layout': download(item, true); break;
    case 'preview': previewItem = item; previewVersion = 'original'; $('#preview-dialog').showModal(); displayPreview(); break;
    case 'preview-layout': previewItem = item; previewVersion = 'layout'; $('#preview-dialog').showModal(); displayPreview(); break;
    case 'layout':
      if (item.state !== 'ready' || layoutBusy(item)) return;
      item.layoutState = 'queued'; item.layoutMessage = '排版任务已加入队列…';
      announce('正在根据原 PDF 的页面、文字坐标和图形进行排版。原转换文件不会被覆盖。');
      renderList(); processQueue(); break;
    case 'retry': item.state = 'queued'; item.message = '等待重试'; renderList(); processQueue(); break;
    case 'remove': items.splice(items.indexOf(item), 1); renderList(); break;
  }
});
$('#clear-button').addEventListener('click', () => { if (running) return; items.length = 0; announce('文件列表已清空。'); renderList(); });
$('#close-preview').addEventListener('click', () => $('#preview-dialog').close());
$('#preview-dialog').addEventListener('close', () => { previewGeneration++; previewItem = null; clearPreviewImages(); $('#preview-content').replaceChildren(); });
$('#preview-dialog').addEventListener('click', (event) => { if (event.target === $('#preview-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('#original-tab').addEventListener('click', () => { previewVersion = 'original'; displayPreview(); });
$('#result-tab').addEventListener('click', () => { previewVersion = 'result'; displayPreview(); });
$('#layout-tab').addEventListener('click', () => { previewVersion = 'layout'; displayPreview(); });
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
