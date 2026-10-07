# Agent 学习路线 · Stray

网站代码内置于个人网站的 tools/agent-learning/，采用相同的灰白底色、深蓝强调色、宽页头、细线分隔和夜间模式。

包含六阶段、24个学习项、六个个人项目与18个项目验收项。项目覆盖 C 语言调试、电桥资料检索、学习笔记 Skill、周复盘与学习 Agent。

## 运行

静态页面，无构建依赖。用任意静态服务器服务此目录。使用 node tools/agent-learning/tests/verify.cjs 在仓库根目录验证。

## 访问与发布

正式站点：https://stray-agent-learning.stray9728.chatgpt.site ，由 Sites 提供私密访问控制。当前源码保存于独立分支，尚未合并到 GitHub Pages 发布分支。

本仓库公开，因此源码可见；网页公开发布需用户确认后再合并。noindex 不是访问控制。不要将私密学习记录、进度 JSON 或密钥提交到仓库。

## 使用与维护

进度与笔记自动保存在当前浏览器，可导出 JSON 并在其他设备恢复；无云端同步。应用不调用模型，不安装插件或 Skill。项目在已有的 AI 应用或开发环境中完成。

curriculum.js 保存课程内容；progress.js 管理记录与校验；app.js 提供交互；style.css 提供响应式布局。源码集成包下载链接指向私密正式站点。

31项功能检查通过；环境未能验证真实浏览器视觉布局。
