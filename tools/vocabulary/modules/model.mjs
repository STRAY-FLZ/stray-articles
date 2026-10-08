/** @typedef {import('./contracts.d.ts').Sense} Sense */
/** @typedef {import('./contracts.d.ts').Word} Word */
export const SCHEMA_VERSION = 2;
export const DEFAULTS = Object.freeze({
  newLimit: 20,
  reviewLimit: 200,
  retention: 0.9,
  exam: "all",
  collectionId: "default",
  bookmarkPriority: false,
  highFrequencyThreshold: 100,
  sessionSize: 100,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
});
export const STATES = ["未学习", "学习中", "复习中", "重新学习"];
export const normalizeText = (s) =>
  (typeof s === "string" ? s : "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
export const canonical = (s) => normalizeText(s).toLowerCase();
export function stableId(value) {
  // Two independent 32-bit hashes; collision checks are also made at import time.
  let a = 2166136261,
    b = 5381;
  for (const c of String(value)) {
    const n = c.codePointAt(0);
    a = Math.imul(a ^ n, 16777619);
    b = Math.imul(b, 33) ^ n;
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
export const uid = () => crypto.randomUUID();
export function pos(s) {
  const map = {
    n: "noun",
    "n.": "noun",
    名词: "noun",
    v: "verb",
    "v.": "verb",
    动词: "verb",
    adj: "adjective",
    "adj.": "adjective",
    形容词: "adjective",
    adv: "adverb",
    "adv.": "adverb",
    副词: "adverb",
  };
  return map[canonical(s)] || canonical(s);
}
export function tags(input) {
  const arr = Array.isArray(input)
    ? input.filter((x) => typeof x === "string")
    : normalizeText(input).split(/[,，;；/、\s]+/);
  return [
    ...new Set(
      arr.filter(Boolean).map(
        (x) =>
          ({
            CET4: "CET-4",
            CET6: "CET-6",
            四级: "CET-4",
            六级: "CET-6",
            雅思: "IELTS",
          })[String(x).toUpperCase()] || normalizeText(x).toUpperCase(),
      ),
    ),
  ];
}
export function senseIdentity(s) {
  return JSON.stringify([
    pos(s.partOfSpeech),
    canonical(s.definitionEN),
    canonical(s.definitionZH),
    canonical(s.dictionarySource),
    canonical(s.dictionaryVersion),
  ]);
}
export function normalizeRecord(raw, location = "") {
  const issues = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {
      issues: [{ location, severity: "error", message: "记录必须为对象" }],
    };
  const word = normalizeText(raw.word ?? raw["单词"]);
  if (!word || word.length > 200 || !/[a-zA-Z]/.test(word))
    return {
      issues: [
        {
          location,
          severity: "error",
          message: "缺少有效英文 word（最多 200 字符）",
        },
      ],
    };
  const homograph = normalizeText(
    raw.homographKey ?? raw.sourceMetadata?.homographKey,
  );
  const wordId = "w_" + stableId(canonical(word) + "|" + homograph);
  let sourceSenses = raw.senses ?? raw.meanings;
  if (!Array.isArray(sourceSenses)) sourceSenses = [raw];
  const senses = [];
  sourceSenses.forEach((s, i) => {
    if (!s || typeof s !== "object") {
      issues.push({
        location: `${location} / 词义 ${i + 1}`,
        severity: "error",
        message: "词义必须为对象",
      });
      return;
    }
    const definitionEN = normalizeText(
      s.definitionEN ?? s.englishDefinition ?? s["英文释义"],
    );
    const definitionZH = normalizeText(
      s.definitionZH ?? s.chineseDefinition ?? s["中文释义"],
    );
    const partOfSpeech = pos(
      s.partOfSpeech ?? raw.partOfSpeech ?? s.pos ?? raw.pos,
    );
    if (!definitionEN || !definitionZH || !partOfSpeech) {
      issues.push({
        location: `${location} / 词义 ${i + 1}`,
        severity: "error",
        message: "每个词义需有词性及一一对应的英文、中文释义；该词义未导入",
      });
      return;
    }
    if (definitionEN.length > 10000 || definitionZH.length > 10000) {
      issues.push({
        location,
        severity: "error",
        message: "释义超过 10000 字符",
      });
      return;
    }
    const dictionarySource = normalizeText(
      s.dictionarySource ?? raw.dictionarySource,
    );
    const dictionaryVersion = normalizeText(
      s.dictionaryVersion ?? raw.dictionaryVersion,
    );
    if (!dictionarySource)
      issues.push({
        location: `${location} / 词义 ${i + 1}`,
        severity: "warning",
        message: "缺少释义来源，显示为“来源未提供”",
      });
    let examples =
      s.examples ??
      (s.example
        ? [
            {
              sentence: s.example,
              exampleTranslation: s.exampleTranslation,
              exampleSource: s.exampleSource,
            },
          ]
        : []);
    if (!Array.isArray(examples)) examples = [];
    examples = examples
      .filter((e) => e && typeof e === "object")
      .map((e) => ({
        sentence: normalizeText(e.sentence ?? e.exampleEN ?? e.text),
        exampleTranslation: normalizeText(
          e.exampleTranslation ?? e.translationZH ?? e.translation,
        ),
        exampleSource: normalizeText(e.exampleSource ?? e.source),
        sourceType: normalizeText(e.sourceType),
        exam: tags(e.exam)[0] || "",
        audioUS: "",
      }))
      .filter((e) => e.sentence);
    if (!examples.length)
      issues.push({
        location: `${location} / 词义 ${i + 1}`,
        severity: "warning",
        message: "缺少例句，未自动补写",
      });
    const sense = {
      partOfSpeech,
      definitionEN,
      definitionZH,
      dictionarySource,
      dictionaryVersion,
      examples,
      examTags: tags(s.examTags ?? raw.examTags),
      senseFrequency: validateFrequency(s.senseFrequency, issues, location),
      sourceOrder: i,
      sourceSenseId: normalizeText(s.senseId),
      synonyms: Array.isArray(s.synonyms) ? s.synonyms.map(canonical) : [],
      semanticCategory: normalizeText(s.semanticCategory),
      highPriority: s.highPriority === true,
    };
    sense.senseId = "s_" + stableId(wordId + "|" + senseIdentity(sense));
    if (!senses.some((e) => e.senseId === sense.senseId)) senses.push(sense);
  });
  if (!senses.length) return { issues };
  let audioUS = normalizeText(raw.audioUS);
  if (audioUS) {
    try {
      if (new URL(audioUS).protocol !== "https:") audioUS = "";
    } catch {
      audioUS = "";
    }
  }
  const record = {
    wordId,
    word,
    search: canonical(word),
    homographKey: homograph,
    ipaUS: normalizeText(raw.ipaUS),
    audioUS,
    partOfSpeech: [...new Set(senses.map((s) => s.partOfSpeech))],
    senses,
    examTags: [
      ...new Set([...tags(raw.examTags), ...senses.flatMap((s) => s.examTags)]),
    ],
    collectionIds: [],
    bookmark: 0,
    sourceMetadata:
      raw.sourceMetadata && typeof raw.sourceMetadata === "object"
        ? raw.sourceMetadata
        : {},
    importMetadata: [],
  };
  if (!record.ipaUS)
    issues.push({
      location,
      severity: "warning",
      message: "缺少美式 IPA，未自动补写",
    });
  return { record, issues };
}
function validateFrequency(input, issues, location) {
  const result = {};
  if (!input || typeof input !== "object") return result;
  for (const [exam, f] of Object.entries(input)) {
    if (!f || typeof f !== "object") continue;
    const count = Number(f.count),
      sampleSize = Number(f.sampleSize);
    if (
      f.level !== "sense" ||
      !normalizeText(f.source) ||
      !normalizeText(f.methodology) ||
      !normalizeText(f.corpusId) ||
      !normalizeText(f.measurement) ||
      f.reliable !== true ||
      !Number.isFinite(count) ||
      count < 0 ||
      !Number.isFinite(sampleSize) ||
      sampleSize <= 0 ||
      count > sampleSize
    ) {
      issues.push({
        location,
        severity: "warning",
        message: `${exam} 的词义频率缺少可靠的词义标注、分母或来源，已忽略`,
      });
      continue;
    }
    result[tags(exam)[0]] = {
      level: "sense",
      count,
      sampleSize,
      source: normalizeText(f.source),
      corpusId: normalizeText(f.corpusId),
      methodology: normalizeText(f.methodology),
      measurement: normalizeText(f.measurement),
      reliable: true,
    };
  }
  return result;
}
export function validatePreferences(input) {
  const p = { ...DEFAULTS, ...input };
  for (const [k, min, max] of [
    ["newLimit", 0, 500],
    ["reviewLimit", 0, 5000],
    ["sessionSize", 1, 500],
    ["highFrequencyThreshold", 0, 1000000],
  ])
    if (!Number.isInteger(p[k]) || p[k] < min || p[k] > max)
      throw new Error(`设置 ${k} 超出范围`);
  if (!Number.isFinite(p.retention) || p.retention < 0.7 || p.retention > 0.99)
    throw new Error("目标记忆保持率应为 70%–99%");
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format();
  } catch {
    throw new Error("时区无效");
  }
  if (typeof p.bookmarkPriority !== "boolean")
    throw new Error("收藏优先设置必须为布尔值");
  if (typeof p.collectionId !== "string" || typeof p.exam !== "string")
    throw new Error("词库或考试设置无效");
  return p;
}
const dateFormatters = new Map();
export function dayKey(timestamp = Date.now(), timezone = DEFAULTS.timezone) {
  if (!dateFormatters.has(timezone))
    dateFormatters.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
  const parts = Object.fromEntries(
    dateFormatters
      .get(timezone)
      .formatToParts(new Date(timestamp))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function dayRange(now, timezone) {
  const key = dayKey(now, timezone);
  let lo = now - 36 * 3600000,
    hi = now;
  while (hi - lo > 1) {
    const m = Math.floor((lo + hi) / 2);
    if (dayKey(m, timezone) < key) lo = m;
    else hi = m;
  }
  const start = hi;
  lo = now;
  hi = now + 36 * 3600000;
  while (hi - lo > 1) {
    const m = Math.floor((lo + hi) / 2);
    if (dayKey(m, timezone) === key) lo = m;
    else hi = m;
  }
  return { start, end: hi };
}
