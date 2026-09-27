# 给 Stray 网站加入自己的美术

网站的文章、栏目和外观是分开的。你可以先只换图片和颜色，不必碰文章正文。

## 一张图就能开始

1. 把首页作品导出为 `hero.webp` 或 `hero.png`，放进 `assets/art/` 文件夹。建议横向画布约 1600 × 1200 像素；如果是人物剪影、拼贴或插画，可以导出透明背景的 PNG。
2. 打开网站根目录的 `art.css`，把 `--art-hero-image: none;` 改为 `--art-hero-image: url("assets/art/hero.webp");`。如果是 PNG，把扩展名改为 `.png`。
3. 刷新网页预览。确认满意后，把新图片和改过的 `art.css` 一起上传到 GitHub 仓库，GitHub Pages 会随提交更新。

右侧的抽象图形是默认占位设计；加入图片后，图片会覆盖它。透明图片会与底下的图形叠加。

## 每个位置对应哪个变量

| 页面位置 | `art.css` 变量 | 建议图片 |
| --- | --- | --- |
| 首页右侧主视觉 | `--art-hero-image` | `assets/art/hero.webp` |
| “灵感”栏目页 | `--art-inspiration-image` | `assets/art/inspiration.webp` |
| “游记”栏目页 | `--art-travel-image` | `assets/art/travel.webp` |
| “关于”页面 | `--art-about-image` | `assets/art/about.webp` |

栏目页图片建议使用约 1200 × 900 像素的横向画面。它们会填满画框，窄屏可能裁掉边缘，请把主体放在中间。首页主视觉以“完整呈现”为优先，更适合透明人物插画或留白充足的拼贴。

## 换成自己的配色

同一个 `art.css` 文件开头还有颜色变量：`--paper` 是背景，`--ink` 是正文，`--blue` 是按钮和链接，`--accent` 是点缀色，`--muted` 是次要文字，`--line` 是分隔线。每次先改一两项，刷新预览检查文字对比度，再继续调整。

## 设计交付给我时

直接提供图片文件，说明“这张用于首页主视觉”或“这张用于灵感栏目”；也可以提供 Figma/Canva 导出的 PNG、WebP、SVG 或一张完整设计稿截图。我会帮你裁切、放入对应位置，并调节留白、颜色和手机布局。使用他人的照片、字体或插画前，请先确认公开展示的使用权。
