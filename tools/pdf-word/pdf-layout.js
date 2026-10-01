// Browser-only PDF layout reconstruction. Preview and DOCX share this page model.
const SVG_NS = 'http://www.w3.org/2000/svg';
const PREVIEW_PAGES = 5;
const PX_PER_POINT = 96 / 72;
const EMU_PER_POINT = 12700;
const normalizeText = (text) => text.normalize('NFKC').replace(/\s/g, '');

function paintInformation(operators, OPS) {
  let state = { color: '000000', font: '', mode: 0, opacity: 1 };
  const stack = [], paints = [], textOperators = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].filter(Number.isInteger));
  let specialText = false;
  for (let index = 0; index < operators.fnArray.length; index++) {
    const fn = operators.fnArray[index], args = operators.argsArray[index] || [];
    if (fn === OPS.save) stack.push({ ...state });
    else if (fn === OPS.restore) state = stack.pop() || state;
    else if (fn === OPS.setFont) state.font = args[0];
    else if (fn === OPS.setTextRenderingMode) state.mode = args[0];
    else if (fn === OPS.setFillRGBColor) {
      state.color = typeof args[0] === 'string' ? args[0].replace('#', '').toUpperCase() : args.map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    } else if (fn === OPS.setFillGray) {
      const gray = Math.round(args[0] * 255).toString(16).padStart(2, '0'); state.color = gray.repeat(3).toUpperCase();
    } else if (fn === OPS.setGState) {
      for (const [key, value] of args[0] || []) if (key === 'ca') state.opacity = value;
    } else if (textOperators.has(fn)) {
      const glyphs = args.find(Array.isArray) || [];
      const text = normalizeText(glyphs.map((glyph) => typeof glyph === 'object' && glyph ? glyph.unicode || '' : '').join(''));
      if (text) {
        // Word often exports synthetic bold CJK as fill-and-stroke text (mode 2).
        specialText ||= ![0, 2].includes(state.mode) || state.opacity !== 1;
        paints.push({ text, font: state.font, bold: state.mode === 2, color: /^[A-F0-9]{6}$/.test(state.color) ? state.color : '000000' });
      }
    }
  }
  let cursor = 0, offset = 0;
  return {
    specialText, textOperators,
    styleFor(entry) {
      const text = normalizeText(entry.str);
      for (let index = cursor; index < Math.min(paints.length, cursor + 80); index++) {
        const paint = paints[index];
        if (paint.font !== entry.fontName) continue;
        const start = paint.text.indexOf(text, index === cursor ? offset : 0);
        if (start !== -1) {
          cursor = index; offset = start + text.length;
          if (offset === paint.text.length) { cursor++; offset = 0; }
          return { color: paint.color, bold: paint.bold };
        }
        if (text.startsWith(paint.text.slice(index === cursor ? offset : 0))) { cursor = index + 1; offset = 0; return { color: paint.color, bold: paint.bold }; }
      }
      return { color: '000000', bold: false };
    },
  };
}

function fontInformation(page, entry, style) {
  const source = page.commonObjs.has(entry.fontName) ? page.commonObjs.get(entry.fontName) : null;
  const name = (source?.name || '').replace(/^[A-Z]{6}\+/, '');
  let family;
  if (/times/i.test(name)) family = 'Times New Roman';
  else if (/helvetica|arial/i.test(name)) family = 'Arial';
  else if (/courier/i.test(name)) family = 'Courier New';
  else if (/simsun|songti|songstd|stsong|serifcjk/i.test(name)) family = 'SimSun';
  else if (/simhei|heiti|heistd/i.test(name)) family = 'SimHei';
  else if (/yahei/i.test(name)) family = 'Microsoft YaHei';
  else if (/kaiti|kaistd/i.test(name)) family = 'KaiTi';
  else family = name.replace(/[-,](bold|italic|regular|roman|oblique).*/i, '').replace(/[^\p{L}\p{N} _-]/gu, '') || (style.fontFamily === 'serif' ? 'Times New Roman' : 'Arial');
  if (!document.fonts.check(`12px "${family}"`, entry.str)) family = /[\u3400-\u9fff]/.test(entry.str) ? 'SimSun' : style.fontFamily === 'serif' ? 'Times New Roman' : 'Arial';
  return { family, bold: !!(source?.bold || source?.black || /bold|black/i.test(name)), italic: !!(source?.italic || /italic|oblique/i.test(name)), unsupported: !!source?.isType3Font };
}

function pageText(page, content, viewport, library, paints) {
  const entries = content.items.filter((entry) => entry.str?.trim());
  if (entries.length > 4000) return { boxes: [], reason: '文字片段过多' };
  const measure = document.createElement('canvas').getContext('2d');
  const boxes = [];
  for (const entry of entries) {
    const style = content.styles[entry.fontName] || {};
    const matrix = library.Util.transform(viewport.transform, entry.transform);
    const angle = Math.atan2(matrix[1], matrix[0]);
    const size = Math.round(Math.hypot(matrix[2], matrix[3]) * 2) / 2;
    const font = fontInformation(page, entry, style);
    const paint = paints.styleFor(entry);
    font.bold ||= paint.bold;
    // Unsupported painting stays visible as a full-page image, never silently lost.
    if (style.vertical || font.unsupported || Math.abs(angle) > .015 || entry.dir === 'rtl' || Math.abs(matrix[2]) > size * .03) return { boxes: [], reason: '竖排、旋转或特殊字体' };
    if (!Number.isFinite(size) || size < 1 || size > 400 || !Number.isFinite(entry.width) || entry.width <= 0) return { boxes: [], reason: '特殊文字尺寸' };
    measure.font = `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${size}px "${font.family}"`;
    const naturalWidth = measure.measureText(entry.str).width;
    const scale = Math.max(10, Math.min(600, Math.round(entry.width / Math.max(.1, naturalWidth) * 100)));
    const box = {
      text: entry.str, x: matrix[4], baseline: matrix[5], size, font: font.family,
      bold: font.bold, italic: font.italic, color: paint.color, scale,
      width: entry.width + Math.max(2, size * .18), height: size * 1.5,
      textWidth: naturalWidth * scale / 100,
      // Match Word's exact-line-height textbox baseline, rather than PDF ink bounds.
      y: matrix[5] - size, lineHeight: size * 1.2,
    };
    if (box.x < -1 || box.y < -1 || box.x + entry.width > viewport.width + 2 || box.baseline > viewport.height + 2) return { boxes: [], reason: '文字超出页面边界' };
    boxes.push(box);
  }
  return { boxes, reason: entries.length ? '' : '没有可提取文字' };
}

function floating(docx, x, y, behindDocument, zIndex) {
  return {
    horizontalPosition: { relative: docx.HorizontalPositionRelativeFrom.PAGE, offset: Math.round(x * EMU_PER_POINT) },
    verticalPosition: { relative: docx.VerticalPositionRelativeFrom.PAGE, offset: Math.round(y * EMU_PER_POINT) },
    wrap: { type: docx.TextWrappingType.NONE }, allowOverlap: true, behindDocument,
    layoutInCell: false, lockAnchor: true, zIndex,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function documentSection(model, data, docx) {
  const { Paragraph, TextRun, ImageRun, WpsShapeRun } = docx;
  const runs = [new ImageRun({
    type: 'png', data,
    transformation: { width: model.width * PX_PER_POINT, height: model.height * PX_PER_POINT },
    floating: floating(docx, 0, 0, true, 1),
    altText: { name: model.reason ? '整页图像' : '原 PDF 图片与图形', description: `第 ${model.number} 页` },
  })];
  for (const [index, box] of model.boxes.entries()) {
    runs.push(new WpsShapeRun({
      type: 'wps', transformation: { width: box.width * PX_PER_POINT, height: box.height * PX_PER_POINT },
      floating: floating(docx, box.x, box.y, false, index + 2),
      outline: { type: 'noFill' },
      bodyProperties: { margins: { left: 0, right: 0, top: 0, bottom: 0 }, verticalAnchor: 't', noAutoFit: true },
      children: [new Paragraph({
        spacing: { before: 0, after: 0, line: Math.round(box.lineHeight * 20), lineRule: docx.LineRuleType.EXACT },
        contextualSpacing: false, keepNext: false, keepLines: false,
        children: [new TextRun({ text: box.text, size: Math.round(box.size * 2), font: { ascii: box.font, hAnsi: box.font, eastAsia: box.font, cs: box.font }, bold: box.bold, italics: box.italic, color: box.color, scale: box.scale })],
      })],
    }));
  }
  return {
    properties: {
      type: docx.SectionType.NEXT_PAGE,
      page: { size: { width: Math.round(model.width * 20), height: Math.round(model.height * 20) }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } },
    },
    children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: docx.LineRuleType.EXACT }, children: runs })],
  };
}

export async function createLayoutDocument(file, { openPdf, getPdfLibrary, onProgress }) {
  const library = await getPdfLibrary(), docx = window.docx;
  const pdf = await openPdf(await file.arrayBuffer());
  const sections = [], pages = [];
  let imagePages = 0, editableFragments = 0;
  try {
    if (pdf.numPages > 60) throw new Error('一键排版最多支持 60 页 PDF，请拆分后重试。');
    for (let number = 1; number <= pdf.numPages; number++) {
      onProgress(`正在排版第 ${number} / ${pdf.numPages} 页…`);
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 });
      if (viewport.width < 90 || viewport.height < 90 || viewport.width > 1584 || viewport.height > 1584) throw new Error('页面尺寸超出 Word 支持范围，请先缩小原 PDF 页面后重试。');
      const [operators, content] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
      const paints = paintInformation(operators, library.OPS);
      const text = paints.specialText ? { boxes: [], reason: '特殊文字绘制或隐藏文字层' } : pageText(page, content, viewport, library, paints);
      const model = { number, width: viewport.width, height: viewport.height, ...text };
      if (model.reason) imagePages++;
      editableFragments += model.boxes.length;
      const renderViewport = page.getViewport({ scale: Math.min(1.6, Math.sqrt(12_000_000 / (viewport.width * viewport.height))) });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(renderViewport.width); canvas.height = Math.ceil(renderViewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext('2d'), viewport: renderViewport, background: '#ffffff',
          operationsFilter: model.reason ? undefined : (index) => !paints.textOperators.has(operators.fnArray[index]),
        }).promise;
        const background = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!background) throw new Error('无法生成页面图像，请缩小 PDF 后重试。');
        sections.push(documentSection(model, new Uint8Array(await background.arrayBuffer()), docx));
        if (number <= PREVIEW_PAGES) pages.push({ ...model, background });
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onProgress('正在生成排版后的 DOCX…');
    const result = await docx.Packer.toBlob(new docx.Document({
      title: 'PDF 版式还原', creator: 'Stray Tools',
      styles: { default: { document: { run: { size: 2 }, paragraph: { spacing: { before: 0, after: 0 } } } } },
      sections,
    }));
    if (!result.size) throw new Error('排版文件生成失败，请重试。');
    return { result, pages, totalPages: pdf.numPages, imagePages, editableFragments };
  } finally { await pdf.loadingTask.destroy(); }
}

export function layoutPreview(layout, registerUrl) {
  const fragment = document.createDocumentFragment();
  for (const model of layout.pages) {
    const figure = document.createElement('figure'); figure.className = 'layout-preview-page';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${model.width} ${model.height}`);
    svg.setAttribute('aria-label', `第 ${model.number} 页排版结果`);
    const background = document.createElementNS(SVG_NS, 'image');
    background.setAttribute('href', registerUrl(model.background));
    background.setAttribute('width', model.width); background.setAttribute('height', model.height); svg.append(background);
    for (const box of model.boxes) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.textContent = box.text;
      text.setAttribute('x', box.x); text.setAttribute('y', box.baseline);
      text.setAttribute('font-size', box.size); text.setAttribute('font-family', box.font);
      text.setAttribute('font-weight', box.bold ? '700' : '400'); text.setAttribute('font-style', box.italic ? 'italic' : 'normal');
      text.setAttribute('fill', `#${box.color}`); text.setAttribute('textLength', box.textWidth); text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      text.setAttribute('xml:space', 'preserve'); text.dataset.layoutText = ''; svg.append(text);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = `第 ${model.number} 页${model.reason ? ` · 图像保留：${model.reason}` : ' · 文字可编辑，图片与图形保留'}`;
    figure.append(svg, caption); fragment.append(figure);
  }
  return fragment;
}
