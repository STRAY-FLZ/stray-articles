# Stray 文字档案

个人文章网站的 GitHub Pages 发布版本。首页按“人物、影像、世界、游记”引导阅读；文章分别放在主题页，不会在首页一次性全部展开。

## 页面

- `index.html`：首页和主题入口
- `topics/people/`、`topics/visual/`、`topics/world/`：分类文章
- `travel/`：未来的游记栏目
- `about/`：关于网站
- `articles/`：四篇文章的正文

## 加入自己的美术

把图片放进 `assets/art/`，然后在 `art.css` 设置对应图片路径和配色。具体尺寸、变量和示例见 [ART_GUIDE.md](ART_GUIDE.md)。网站自带默认抽象图形，暂时没有个人作品也能正常展示。

## 发布与更新

在仓库的 **Settings → Pages** 中，选择 **Deploy from a branch**，分支选 `main`，目录选 `/(root)`。以后更新网页、文章或美术文件，提交到 `main` 后即可重新发布。

本站内容和上传的图片会公开展示。发布前请核对文章署名、正文和图片使用权。
