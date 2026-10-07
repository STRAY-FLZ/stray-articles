# agent入门 · Stray

个人网站“工具”栏中的 agent入门 入口，链接到 https://stray-agent-learning.stray9728.chatgpt.site/ 。网站代码内置于 tools/agent-learning/，沿用个人网站配色、宽页头、细线分隔和夜间模式。

## 内容与运行

六阶段、24个学习项、六个个人项目与18个项目验收项，覆盖 C 语言调试、电桥资料检索、学习笔记 Skill、周复盘与学习 Agent。静态 HTML/CSS/JavaScript，无构建依赖。

用静态服务器服务此目录；在仓库根目录执行 node tools/agent-learning/tests/verify.cjs 验证。

## 发布与数据

用户已确认公开发布。正式 Sites 地址公开可访问；源码同时保存在个人网站仓库。工具页入口使用正式 Sites 地址，保留此前该地址中的浏览器进度。

进度与笔记保存在访客自己的浏览器，没有跨设备同步；可导出 JSON 在其他设备恢复。不会把访客学习记录上传到公开仓库。应用不调用模型，也不会自动安装插件或 Skill。

## 维护与验证

curriculum.js 保存课程内容；progress.js 管理记录与校验；app.js 提供交互；style.css 提供响应式布局。

31项功能检查通过；环境未能验证真实浏览器视觉布局。
