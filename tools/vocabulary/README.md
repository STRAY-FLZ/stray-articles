# 英语背词

集成在 Stray 静态网站的个人词汇应用。入口位于 `tools/index.html`，路由为 `tools/vocabulary/index.html`；浏览器内页面使用 hash 路由。所有资源和“返回首页”使用相对路径，支持 GitHub Pages 的 `/stray-articles/` 项目路径。没有修改 Pages 配置，没有生产部署。

## 本地预览

在仓库根目录执行：

```bash
python -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/tools/vocabulary/index.html`。不要直接用 `file://` 打开，因为 ES 模块、Web Worker 和 IndexedDB 需要正常的 HTTP 同源环境。测试服务器另外验证了 `/stray-articles/tools/vocabulary/` 路径。

## 实际功能

- 首页显示三个入口、每日新词和复习数、到期数、累计学过词数、连续学习天数以及日目标。
- 导入 TXT/Markdown/JSON/JSON Lines，处理 BOM/CRLF，后台解析、校验、预览、去重、合并、批次报告和错误报告下载。
- 独立词义的主动回忆闪卡，隐藏释义直到揭示，四档 FSRS 评分，估计间隔，美式语音、收藏、会话暂停及恢复。
- 综合、收藏、困难、已学词及筛选范围检测；双向选择题、结果、错题重做与持久记录。
- 多词库创建、重命名、删除、切换；按词库、考试、状态、收藏筛选，英文前缀搜索、25 条分页，按需加载详情、学习历史及来源。
- 学习和检测统计、7/30 天图表及可读数据表、词义状态、掌握度、错误率和经常错的词义。
- 设置每日计划、保持率、考试范围、时区及高频阈值；完整 JSON 备份、验证和原子恢复；独立本地档案。
- 复用全站主题及设计变量；中文界面、键盘操作、触摸布局和减少动态效果。

## 技术与模块

运行时：原生 HTML/CSS、浏览器 ES 模块、IndexedDB、Web Worker、Web Speech API。没有框架、服务端、账号系统或运行时 CDN。FSRS 官方模块约 61 KB，非首屏页面按需加载。

| 文件 | 职责 |
|---|---|
| `app.mjs` | hash 路由、页面生命周期和错误通知 |
| `modules/model.mjs` | 数据契约、稳定标识、规范化、设置与日期边界 |
| `modules/parser.mjs`、`import-worker.mjs` | 格式识别、分格式解析、校验与后台导入解析 |
| `modules/storage.mjs` | 统一 IndexedDB 访问、分批事务导入、原子评分、备份与恢复 |
| `modules/ranking.mjs` | 独立词义频率排序和例句来源优先级 |
| `modules/scheduler.mjs`、`vendor/ts-fsrs.mjs` | FSRS 适配和官方调度算法 |
| `modules/session.mjs` | 随机新词、到期队列、日上限及会话恢复 |
| `modules/assessment.mjs`、`assessment-worker.mjs` | 双向题生成、干扰项、评分和后台生成 |
| `modules/analytics.mjs` | 基于真实事件的统计 |
| `modules/*-view.mjs`、`ui.mjs` | 独立页面及转义渲染 |
| `modules/export-spec.mjs`、`fixtures/demonstration.txt` | 可复制 GLM 规范及明确标注的测试数据 |
| `tests/` | 核心、静态、真实 Chromium/IndexedDB 集成和压力测试 |

本仓库原来不使用 TypeScript。实现保留 JavaScript，不要求编译；模型有 JSDoc、`modules/contracts.d.ts` 数据契约与边界校验，FSRS 的官方类型声明保存在 vendor 中。`npm run build` 是静态生产资源及语法检查，网站本身不需要打包。ESLint 和 Playwright 仅是开发依赖。

## FSRS 配置及记忆模型

使用官方 `ts-fsrs 5.4.2`，实际算法 **FSRS-6.0**，MIT 许可。`vendor/VENDOR.md` 记录来源与校验和。没有修改算法源码或替代为固定间隔。

- 默认 `request_retention: 0.9`，界面可设置 0.70–0.99。
- `maximum_interval: 36500` 天。
- `enable_short_term: true`；初学步骤 `1m, 10m`；重新学习步骤 `10m`。
- `enable_fuzz: false`，用于可复现的预览和测试；长期间隔仍由 FSRS 的 D/S/R 模型计算。
- 保留 `due, last_review, state, difficulty, stability, elapsed_days, scheduled_days, reps, lapses, learning_steps`。每次评分保存独立 ReviewLog，R 根据状态和时间计算。
- `wordId` 对规范化拼写和可选 `homographKey` 稳定；词义标识包含词性、对齐的中英文释义及来源/版本。`unitId = wordId:senseId`。
- 不同词性/词义独立学习；同一个词义跨词库共享进度。未改变的内容重新导入不会重置学习。
- 如果释义/来源发生实质变化，新增独立词义并保留旧词义与历史，避免错误继承掌握度。来源提供的 senseId 另外保留为 sourceSenseId；不使用未经验证的源 ID 覆盖已有内容。
- 默认每天 20 个新单词。日新词按独立单词计；Review 上限按每天首次复习的独立 Review 词义计，Learning/Relearning 的到期义务不受此上限影响。
- 队列先处理到期项目，按到期时间排序，随机选择新词；同一单词避免连续出现。超出本轮/每日上限的项目保留到期记录，不丢弃。
- 目标学习也遵守到期时间，尚未到期的词可做独立检测，不提前改变调度。
- 评分与事件、词条摘要、会话推进在同一个事务内写入；事件 ID、词义 revision 和会话 index 防止重复评分及跨页冲突。
- 页面保存当前队列和短期等待事项；刷新、返回或重新检查队列时插入已经到期的短期复习，不强迫提前重复。

## 导入与 GLM 格式

“我的词库 → 创建词库 → 导入 TXT → 选择目标词库 → 预览 → 确认保存”。词库为空时不预装字典；可下载/预览独立演示文件。

推荐 UTF-8 **JSON Lines `.txt`**。每行一个对象，必需：`word` 和 `senses`；每个 sense 必需 `partOfSpeech, definitionEN, definitionZH`。其他可用字段：

- 词条：`ipaUS, audioUS（HTTPS）, examTags, homographKey, sourceMetadata`。
- 词义：`senseId, dictionarySource, dictionaryVersion, examples, examTags, senseFrequency, semanticCategory, synonyms, highPriority`。
- 例句：`sentence, exampleTranslation, exampleSource, sourceType（exam/news/dictionary/original）, exam`。
- 词义频率：`level:"sense", count, sampleSize, source, corpusId, methodology, measurement, reliable:true`。任何缺少可靠标注/分母/来源的数据都不参与排序。

下列三条均为**原创教学演示数据，非真实词典原文或考试题目**：

```jsonl
{"word":"record","ipaUS":"/ˈrekərd/（名词）；/rɪˈkɔːrd/（动词）","examTags":["CET-4","CET-6"],"senses":[{"partOfSpeech":"noun","definitionEN":"information kept for later use","definitionZH":"供以后使用而保存的记录","dictionarySource":"原创教学演示（非词典原文）","examples":[{"sentence":"Keep a record of your reading.","exampleTranslation":"记录你的阅读情况。","exampleSource":"原创教学演示","sourceType":"original"}]},{"partOfSpeech":"verb","definitionEN":"to save sound or information","definitionZH":"录制声音或记录信息","dictionarySource":"原创教学演示（非词典原文）"}]}
{"word":"light","ipaUS":"/laɪt/","examTags":["CET-4","IELTS"],"senses":[{"partOfSpeech":"noun","definitionEN":"brightness that makes things visible","definitionZH":"使物体可见的光","dictionarySource":"原创教学演示（非词典原文）"},{"partOfSpeech":"adjective","definitionEN":"having little weight","definitionZH":"重量轻的","dictionarySource":"原创教学演示（非词典原文）"}]}
{"word":"adapt","ipaUS":"/əˈdæpt/","examTags":["CET-6","IELTS"],"senses":[{"partOfSpeech":"verb","definitionEN":"to change to suit new conditions","definitionZH":"调整以适应新的条件","dictionarySource":"原创教学演示（非词典原文）"}]}
```

完整 copyable 规范在导入界面的折叠栏中，也在 `modules/export-spec.mjs`。结构化 TXT 支持 `单词/word`、`美式音标/ipaUS`、`词性/partOfSpeech`、`英文释义/definitionEN`、`中文释义/definitionZH`、`例句/example`、`例句翻译/exampleTranslation`、`例句来源/exampleSource`、`词典来源/dictionarySource`、`词典版本/dictionaryVersion`、`考试标签/examTags` 等标签；空行可用于排版，新的 word 或明显分隔符开始下一词条。Markdown 可用 `## word`、列表/加粗字段标签及 `### 词义 2`。JSON 支持单对象、数组或 `{words:[...]}`。

导入只保存具备成对释义及词性的词义，缺失 IPA、例句、来源会明确提示，不编造。相同词可合并标签、词义和收藏之外的内容，也可选择跳过已有词。后台解析和每批 100 条的事务避免大文件长时间阻塞；失败批次回滚，已经成功的批次和原有数据保留，完整报告可下载。重复文件不会重复加入来源批次。

## 词义频率、例句与检测

仅接受可靠 **sense-level** 数据。将每个词义的实际计数除以对应样本量，得到每百万标注样本的比例。在同一考试内，所有词义须具备相同语料覆盖和相容的标注方法/统计单位；否则保持原始顺序。“全部考试”对相容统计的标准化比例等权平均；不兼容或缺少数据时也保留原始顺序。不把整词频率写到词义，也不生成任何考试统计。

例句按真实考试、新闻、词典、原创的类型顺序选择，保留实际署名和译文；来源缺失时明确显示。字典内容来自用户合法提供的文件，不抓取或假冒 Oxford/Cambridge/Collins 内容。

检测的题数分配：英译中 `Math.round(N*0.3)`，中译英为余数。题型混合，默认最多四个不同选项，干扰词性匹配，排除相同释义、已知同义词、同一拼写/词条以及中文释义中明显共有的释义项。正确选项位置平衡并随机打散，不用可预测的固定轮转。题目数量不足时缩减并提示，绝不填充无效选项。

双向词义优先由可靠词义频率达到设置的每百万样本阈值，或用户明确的 `highPriority:true` 选出；没有元数据不会强迫双向重复。同词两次至少间隔 1–3 个其他问题（随总题量调整），计为两题，不改变总体比例。测试词条可以仅来自收藏/困难/目标范围；干扰项从同范围词库的合法词性池中选择，可包含尚未学习的词。错题重做是针对实际错题，不强行重新分配 30/70。

中文释义语义是否准确、是否有未标注同义词仍依赖所提供数据，导入器不能自动替代语言学审核。请在真实词库中提供 `synonyms` 或具体的义项解释以避免歧义。

## 数据、备份和安全

数据库名 `stray-vocabulary-<本地档案标识>`，版本 2（从 v1 自动增建 stateDue 组合索引，不改写学习记录）；默认档案 `local`。集中存储 `collections, words, units, events, assessments, sessions, meta`。索引包括 collection、search、exam、bookmark、state、due、wordId、事件时间与检测状态；stateDue 组合索引只查询 Learning/Review/Relearning，到期查询不会读取所有新词。单卡转换不扫描整份词库；只更新当前词义和同词的少量摘要，最多预读后续卡片。

删除分类时，其他词库引用和学习历史保留；无其他引用的词条转入默认“我的词库”。默认词库不可删除。

在“计划与数据”导出完整 JSON；选择备份，校验版本、标识、引用、调度状态、题目/答案及设置后，明确确认**替换**当前档案。支持同结构的 v1 备份恢复到 v2；恢复在一个 IndexedDB 事务中完成；失败不会清空旧数据。学习记录用数值时间戳保存，日期和每日限额使用设置的 IANA 时区，包含夏令时处理。

每个本地档案与浏览器安装隔离，没有自动云同步或账户认证。浏览器可能清理非持久存储，提供请求持久保存的按钮，但仍需定期备份。备份含个人学习资料，请自行保管。所有导入文本转义，不执行 HTML/JS；无遥测或远程词库上传。浏览器发音及用户提供的远程音频依赖其各自播放服务。

## 验证命令

```bash
cd tools/vocabulary
npm ci --ignore-scripts
npm run lint
npm run build
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

默认浏览器测试使用 `/usr/bin/chromium`，也可通过 `CHROMIUM_PATH` 指定其他实际可用 Chromium。测试仅启动 loopback HTTP 服务器，使用隔离浏览器/测试档案，不访问生产服务。需要环境允许浏览器本地 socket。可用 `VOCABULARY_ARTIFACT_DIR` 指定测试截图、备份和指标的保存目录；默认在系统临时目录。无需真实词库；仅用明确标注的演示及合成压力数据。

具体实际结果、环境、测量目标及限制见 `VALIDATION.md`。网页不需要 TypeScript 构建，因此没有单独的 tsc 步骤。请勿将未经审查的实现合并到 main 或修改 Pages 配置；PR base 为 **feature/vocabulary**。
