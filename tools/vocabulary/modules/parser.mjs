import { normalizeRecord } from "./model.mjs";
const labels = {
  word: "word",
  单词: "word",
  词条: "word",
  ipaUS: "ipaUS",
  美式音标: "ipaUS",
  IPA: "ipaUS",
  partOfSpeech: "partOfSpeech",
  pos: "partOfSpeech",
  词性: "partOfSpeech",
  definitionEN: "definitionEN",
  英文释义: "definitionEN",
  英文定义: "definitionEN",
  definitionZH: "definitionZH",
  中文释义: "definitionZH",
  中文定义: "definitionZH",
  dictionarySource: "dictionarySource",
  词典来源: "dictionarySource",
  来源: "dictionarySource",
  dictionaryVersion: "dictionaryVersion",
  词典版本: "dictionaryVersion",
  examTags: "examTags",
  考试标签: "examTags",
  example: "example",
  例句: "example",
  exampleTranslation: "exampleTranslation",
  例句翻译: "exampleTranslation",
  exampleSource: "exampleSource",
  例句来源: "exampleSource",
  homographKey: "homographKey",
};
export function parseVocabulary(text, onProgress = () => {}) {
  text = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text)
    return {
      format: "空文件",
      records: [],
      issues: [
        { location: "文件", severity: "error", message: "文件内容为空" },
      ],
    };
  // A single fenced JSON/JSONL document is also accepted.
  text = text.replace(/^```(?:jsonl?|txt|text)?\s*\n([\s\S]*?)\n```$/i, "$1");
  const items = [],
    issues = [];
  let format;
  if (text.startsWith("[")) {
    format = "JSON";
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw Error();
      arr.forEach((raw, i) => items.push({ raw, location: `记录 ${i + 1}` }));
    } catch (e) {
      issues.push({
        location: "文件",
        severity: "error",
        message: `JSON 数组解析失败：${e.message}`,
      });
    }
  } else if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      format = "JSON";
      const arr = Array.isArray(parsed.words) ? parsed.words : [parsed];
      arr.forEach((raw, i) => items.push({ raw, location: `记录 ${i + 1}` }));
    } catch {
      format = "JSON Lines";
      text.split("\n").forEach((line, i) => {
        if (!line.trim()) return;
        try {
          items.push({ raw: JSON.parse(line), location: `行 ${i + 1}` });
        } catch (e) {
          issues.push({
            location: `行 ${i + 1}`,
            severity: "error",
            message: `JSON 解析失败：${e.message}`,
          });
        }
      });
    }
  } else {
    format = /^#{1,6}\s|\*\*/m.test(text) ? "Markdown" : "结构化 TXT";
    let raw = null,
      sense = null,
      start = 1,
      last = null;
    function flush() {
      if (raw) {
        if (!raw.word)
          issues.push({
            location: `行 ${start}`,
            severity: "error",
            message: "词条缺少 word / 单词标签",
          });
        else items.push({ raw, location: `行 ${start}` });
      }
      raw = null;
      sense = null;
      last = null;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const clean = line.trim();
      if (/^[-=*_]{3,}$/.test(clean)) {
        flush();
        return;
      }
      const heading = clean.match(/^#{1,6}\s+(.*)$/);
      const senseHeading = clean.match(
        /^(?:#{1,6}\s*)?(?:词义|sense)\s*\d*\s*[:：]?\s*$/i,
      );
      if (senseHeading) {
        if (!raw) raw = { senses: [] };
        sense = {};
        raw.senses.push(sense);
        last = null;
        return;
      }
      if (heading) {
        flush();
        raw = { word: heading[1].replace(/^\d+[.)、]\s*/, ""), senses: [] };
        start = i + 1;
        return;
      }
      const m = clean
        .replace(/^[-*+]\s+/, "")
        .replace(/\*\*/g, "")
        .match(/^([^:：]+)[:：]\s*(.*)$/);
      if (m) {
        const key = labels[m[1].trim()];
        if (!key) {
          issues.push({
            location: `行 ${i + 1}`,
            severity: "warning",
            message: `未识别字段 ${m[1].trim()}`,
          });
          return;
        }
        if (key === "word") {
          flush();
          raw = { word: m[2], senses: [] };
          start = i + 1;
          last = null;
          return;
        }
        if (!raw) {
          raw = { senses: [] };
          start = i + 1;
        }
        const wordFields = [
          "ipaUS",
          "examTags",
          "dictionarySource",
          "dictionaryVersion",
          "homographKey",
        ];
        if (wordFields.includes(key) && !sense) {
          raw[key] = m[2];
          last = { obj: raw, key };
          return;
        }
        if (
          !sense ||
          (key === "definitionEN" && sense.definitionEN) ||
          (key === "partOfSpeech" && sense.definitionEN && sense.definitionZH)
        ) {
          sense = {};
          raw.senses.push(sense);
        }
        sense[key] = m[2];
        last = { obj: sense, key };
      } else if (clean && last) {
        last.obj[last.key] += " " + clean;
      } else if (clean) {
        issues.push({
          location: `行 ${i + 1}`,
          severity: "warning",
          message: "未识别的文本，请使用字段标签或 JSON Lines",
        });
      }
    });
    flush();
  }
  const parseFailures = issues.filter((i) => i.severity === "error").length;
  const records = [];
  items.forEach(({ raw, location }, i) => {
    const n = normalizeRecord(raw, location);
    issues.push(...n.issues);
    if (n.record) records.push(n.record);
    if (i % 250 === 0) onProgress({ done: i, total: items.length });
  });
  onProgress({ done: items.length, total: items.length });
  return {
    format,
    records,
    issues,
    total: items.length,
    failed: parseFailures + items.length - records.length,
  };
}
