# Stray 文字档案

个人文章网站的 GitHub Pages 发布版本。首页、四篇文章和游记栏目均为静态网页；无需服务器或数据库。

## 发布

在仓库的 **Settings → Pages** 中，选择 **Deploy from a branch**，分支选 `main`，目录选 `/(root)`。

## 更新

- 首页：`index.html`
- 文章正文：`articles/文章目录/index.html`
- 游记栏目：`travel/index.html`
- 页面样式：`site.css`

新增文章时，可以在 `articles/` 中复制一个文章目录，修改内容，并在首页添加链接。提交到 `main` 后，GitHub Pages 会重新发布。

文章和站点当前会公开展示。发布前请核对题目、署名与正文，并在以后加入照片时确认使用权。
