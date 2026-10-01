# PDF ⇄ Word 初版

地址：`tools/pdf-word/index.html`。用本地 HTTP 服务或 GitHub Pages 打开；ES 模块和 PDF worker 不支持直接通过 `file://` 双击使用。

```powershell
node tools/pdf-word/preview.cjs
```

打开 `http://127.0.0.1:4173/tools/pdf-word/`。也可用任意静态服务器服务整个网站目录。

## 功能

- PDF → DOCX：提取文字生成可编辑 Word；无文字页自动作为图片保留。另有页面图片模式，保留 PDF 视觉版式。
- DOCX → PDF：Mammoth 提取基础内容，按 A4 重新排版，由 html2pdf 生成页面图像 PDF。
- 文件选择、拖拽、多文件排队、原文与结果预览、下载、失败重试、删除与清空。
- 本地转换，不发送文档到任何服务器；所有依赖随页面提供，没有外部 CDN 请求。
- 沿用博客颜色和日夜模式；独立工具页，可从博客“工具”栏目进入。

## 当前限制

单个文件 20 MB，队列 12 个，PDF 60 页；Word 内容高度上限 20,000 CSS 像素（约 20 页，实际取决于排版）。不支持旧版 DOC、加密文件与 OCR。PDF 文字模式不复原复杂表格、多栏与插图；Word 转换不保留页眉页脚与精确分页，生成 PDF 的文字不可选中。预览 PDF 前 5 页，完整文件可下载。

后续可以接入独立转换服务来提高复杂文档保真度；GitHub Pages 仅托管静态页面，目前使用浏览器转换，无需服务器。

## 依赖与许可证

依赖固定存放在 `vendor/`，对应许可证同目录保留：

| 库 | 版本 | 作用 | 许可证 |
| --- | --- | --- | --- |
| PDF.js | 6.3.289 | PDF 文字提取、预览及页面渲染 | Apache-2.0 |
| docx | 9.8.1 | DOCX 生成 | MIT |
| Mammoth | 1.13.0 | DOCX 内容读取 | BSD-2-Clause |
| html2pdf.js | 0.14.0 | HTML 转 PDF | MIT，捆绑依赖见附带许可证 |
| DOMPurify | 3.4.16 | 文档 HTML 清理 | MPL-2.0 或 Apache-2.0 |

这些是初版固定版本。发布前如升级依赖，应重新验证双向转换与预览。
