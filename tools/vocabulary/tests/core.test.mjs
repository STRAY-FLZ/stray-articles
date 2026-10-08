import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecord,
  DEFAULTS,
  dayKey,
  dayRange,
  stableId,
  validatePreferences,
} from "../modules/model.mjs";
import { parseVocabulary } from "../modules/parser.mjs";
import { rankSenses, frequencyScore } from "../modules/ranking.mjs";
import {
  newUnit,
  preview,
  gradeUnit,
  retrievability,
  State,
} from "../modules/scheduler.mjs";
import {
  buildQueue,
  newSession,
  advanceSession,
  releasePending,
} from "../modules/session.mjs";
import {
  generateAssessment,
  allocateDirections,
  assessmentAnswer,
  assessmentResult,
  retryAssessment,
} from "../modules/assessment.mjs";
import { calculateAnalytics } from "../modules/analytics.mjs";
import { DEMO_TEXT, DEMO_RECORDS } from "../modules/export-spec.mjs";
import { validateBackup } from "../modules/storage.mjs";
const now = Date.parse("2026-10-08T08:00:00Z");
function random(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function dataset(n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const w = normalizeRecord({
      word: `item-${i}`,
      ipaUS: "/test/",
      examTags: ["CET-4"],
      senses: [
        {
          partOfSpeech: "noun",
          definitionEN: `distinct concept ${i}`,
          definitionZH: `明确含义 ${i}`,
          dictionarySource: "测试数据",
          highPriority: i < 12,
          examples: [],
        },
      ],
    }).record;
    w.collectionIds = ["default"];
    return w;
  });
}
const words = dataset(),
  units = words.flatMap((w) => w.senses.map((s) => newUnit(w, s, now))),
  prefs = { ...DEFAULTS, timezone: "Asia/Shanghai" };
test("JSON Lines/BOM/CRLF: preserve polysemy and distinct parts of speech", () => {
  const p = parseVocabulary("\ufeff" + DEMO_TEXT.replace(/\n/g, "\r\n"));
  assert.equal(p.format, "JSON Lines");
  assert.equal(p.records.length, 6);
  assert.equal(p.records[0].senses.length, 2);
  assert.notEqual(
    p.records[0].senses[0].senseId,
    p.records[0].senses[1].senseId,
  );
  assert.deepEqual(p.records[0].partOfSpeech, ["noun", "verb"]);
});
test("JSON object, array, words wrapper and fenced input", () => {
  for (const input of [
    JSON.stringify(DEMO_RECORDS),
    JSON.stringify({ words: DEMO_RECORDS }),
    JSON.stringify(DEMO_RECORDS[0]),
    "```json\n" + JSON.stringify(DEMO_RECORDS[0]) + "\n```",
  ])
    assert.ok(parseVocabulary(input).records.length);
});
test("labelled TXT with blank lines, two senses, no fabricated data", () => {
  const text =
    "单词：record\n美式音标：/test/\n考试标签：CET-4, IELTS\n\n词性：noun\n英文释义：a saved note\n中文释义：保存的笔记\n例句：Keep a note.\n例句翻译：保留一份笔记。\n\n词性：verb\n英文释义：save a note\n中文释义：保存笔记\n\n单词：river\n词性：noun\n英文释义：a water stream\n中文释义：水流";
  const p = parseVocabulary(text);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0].senses.length, 2);
  assert.equal(p.records[1].ipaUS, "");
});
test("Markdown headings, bullets, bold labels and sense headings", () => {
  const p = parseVocabulary(
    "## adapt\n- **词性**：verb\n- **英文释义**：adjust\n- **中文释义**：适应\n### 词义 2\n词性：verb\n英文释义：change\n中文释义：调整\n---\n## river\n词性：noun\n英文释义：stream\n中文释义：河",
  );
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0].senses.length, 2);
});
test("malformed JSONL line gives exact location; valid entries survive", () => {
  const p = parseVocabulary(
    JSON.stringify(DEMO_RECORDS[0]) +
      "\n{bad}\n" +
      JSON.stringify(DEMO_RECORDS[1]),
  );
  assert.equal(p.records.length, 2);
  assert.ok(
    p.issues.some((i) => i.location === "行 2" && i.severity === "error"),
  );
});
test("missing bilingual definition skips invalid sense only", () => {
  const p = normalizeRecord({
    word: "test",
    senses: [
      { partOfSpeech: "noun", definitionEN: "only English" },
      { partOfSpeech: "verb", definitionEN: "valid", definitionZH: "有效" },
    ],
  });
  assert.equal(p.record.senses.length, 1);
  assert.ok(p.issues.some((i) => i.severity === "error"));
});
test("stable IDs, case-normalized words, homographs and incompatible dictionaries", () => {
  const raw = DEMO_RECORDS[0];
  const a = normalizeRecord(raw).record,
    b = normalizeRecord({ ...raw, word: "Record" }).record,
    c = normalizeRecord({ ...raw, homographKey: "different-root" }).record;
  assert.equal(a.wordId, b.wordId);
  assert.equal(a.senses[0].senseId, b.senses[0].senseId);
  assert.notEqual(a.wordId, c.wordId);
  const d = normalizeRecord({
    ...raw,
    dictionarySource: "different",
    senses: raw.senses.map((s) => ({ ...s, dictionarySource: "different" })),
  }).record;
  assert.notEqual(a.senses[0].senseId, d.senses[0].senseId);
  assert.equal(stableId("x"), stableId("x"));
});
test("reject word frequency masquerading as sense frequency", () => {
  const w = normalizeRecord({
    word: "test",
    senses: [
      {
        partOfSpeech: "noun",
        definitionEN: "one",
        definitionZH: "一",
        senseFrequency: {
          "CET-4": {
            level: "word",
            count: 99,
            sampleSize: 100,
            reliable: true,
          },
        },
      },
    ],
  }).record;
  assert.deepEqual(w.senses[0].senseFrequency, {});
});
const freq = (count, exam = "CET-4", methodology = "manual") => ({
  [exam]: {
    count,
    sampleSize: 1000,
    reliable: true,
    level: "sense",
    source: "test",
    corpusId: "corpus",
    methodology,
    measurement: "sense tokens",
  },
});
test("ranking normalizes counts and preserves original order without compatible evidence", () => {
  const a = { senseId: "a", sourceOrder: 0, senseFrequency: freq(10) },
    b = { senseId: "b", sourceOrder: 1, senseFrequency: freq(30) };
  assert.equal(rankSenses([a, b], "CET-4")[0].senseId, "b");
  assert.equal(frequencyScore(a, "CET-4"), 10000);
  assert.equal(
    rankSenses([a, { ...b, senseFrequency: {} }], "CET-4")[0].senseId,
    "a",
  );
  assert.equal(
    rankSenses(
      [a, { ...b, senseFrequency: freq(30, "CET-4", "other") }],
      "CET-4",
    )[0].senseId,
    "a",
  );
});
test("combined frequency uses deterministic equal-weight normalized rates", () => {
  const s = { senseFrequency: { ...freq(10), ...freq(20, "CET-6") } };
  assert.equal(frequencyScore(s, "all"), 15000);
});
test("FSRS genuine four-rating preview: different due/D/S outcomes", () => {
  const p = preview(units[0], now);
  const dates = [1, 2, 3, 4].map((r) => +p[r].card.due);
  assert.equal(new Set(dates).size, 4);
  assert.ok(p[3].card.stability > 0);
  assert.ok(p[4].card.difficulty < p[1].card.difficulty);
});
test("FSRS New → Learning → Review → Relearning; lapses and dates", () => {
  let u = gradeUnit(units[0], 3, now).unit;
  assert.equal(u.state, State.Learning);
  u = gradeUnit(u, 3, u.due).unit;
  assert.equal(u.state, State.Review);
  const previous = u;
  u = gradeUnit(u, 1, u.due).unit;
  assert.equal(u.state, State.Relearning);
  assert.equal(u.card.lapses, previous.card.lapses + 1);
  assert.ok(u.card.stability < previous.card.stability);
  u = gradeUnit(u, 3, u.due).unit;
  assert.equal(u.state, State.Review);
  assert.equal(typeof u.due, "number");
});
test("Easy immediately enters Review; retention affects long term interval", () => {
  const a = gradeUnit(units[1], 4, now, 0.9).unit,
    b = gradeUnit(units[1], 4, now, 0.97).unit;
  assert.equal(a.state, State.Review);
  assert.ok(b.due < a.due);
  assert.equal(retrievability(a, now), 1);
});
test("independent senses never alter each other when graded", () => {
  const w = parseVocabulary(DEMO_TEXT).records[0],
    a = newUnit(w, w.senses[0], now),
    b = newUnit(w, w.senses[1], now);
  gradeUnit(a, 4, now);
  assert.equal(b.card.reps, 0);
  assert.notEqual(a.unitId, b.unitId);
});
test("queue randomizes new words with deterministic seed and respects new limit", () => {
  const queue = buildQueue({
    units,
    events: [],
    prefs: { ...prefs, newLimit: 20 },
    now,
    rng: random(),
  });
  assert.equal(queue.length, 20);
  assert.notDeepEqual(
    queue,
    units.slice(0, 20).map((u) => u.unitId),
  );
  assert.deepEqual(
    queue,
    buildQueue({
      units,
      events: [],
      prefs: { ...prefs, newLimit: 20 },
      now,
      rng: random(),
    }),
  );
});
test("overdue first, daily review limit and short-term obligations", () => {
  const a = gradeUnit(units[0], 4, now - 1000000000).unit,
    b = gradeUnit(units[1], 1, now - 3600000).unit;
  const queue = buildQueue({
    units: [a, b, ...units.slice(2)],
    events: [],
    prefs: { ...prefs, newLimit: 0, reviewLimit: 0 },
    now,
    rng: random(),
  });
  assert.deepEqual(queue, [b.unitId]);
  const q = buildQueue({
    units: [a, b, ...units.slice(2)],
    events: [],
    prefs: { ...prefs, newLimit: 2, reviewLimit: 1 },
    now,
    rng: random(),
  });
  assert.equal(q[0], a.unitId);
  assert.ok(q.includes(b.unitId));
});
test("daily new words count distinct words; unfinished obligations persist", () => {
  const event = {
    timestamp: now,
    isNewWord: true,
    wordId: units[0].wordId,
    previousState: 0,
  };
  const q = buildQueue({
    units: units.slice(1),
    events: [event],
    prefs: { ...prefs, newLimit: 1 },
    now,
  });
  assert.equal(q.length, 0);
});
test("session serializes, advances once and releases pending only when actually due", () => {
  let s = newSession([units[0].unitId], prefs, now),
    u = gradeUnit(units[0], 1, now).unit;
  s = advanceSession(s, u, now);
  assert.equal(s.index, 1);
  assert.equal(s.pending.length, 1);
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(releasePending(restored, u.due - 1).queue.length, 1);
  assert.equal(releasePending(restored, u.due).queue.length, 2);
});
test("timezone day boundary, DST day duration and validation", () => {
  assert.equal(
    dayKey(Date.parse("2026-10-08T16:00:00Z"), "Asia/Shanghai"),
    "2026-10-09",
  );
  const r = dayRange(Date.parse("2026-03-08T16:00:00Z"), "America/New_York");
  assert.equal(r.end - r.start, 23 * 3600000);
  assert.throws(() => validatePreferences({ ...prefs, retention: 2 }));
});
test("30/70 integer question allocation for all arbitrary counts", () => {
  for (let n = 2; n <= 100; n++) {
    const { en, zh } = allocateDirections(n);
    assert.equal(en + zh, n);
    assert.equal(en, Math.round(n * 0.3));
  }
  for (const [n, en] of [
    [20, 6],
    [30, 9],
    [50, 15],
  ])
    assert.equal(allocateDirections(n).en, en);
});
test("assessment direction counts, interleaving, valid unique options and positional balance", () => {
  for (const n of [7, 20, 30, 50]) {
    const a = generateAssessment(
      words,
      units,
      {
        count: n,
        exam: "all",
        collectionId: "default",
        mode: "all",
        studiedOnly: false,
      },
      prefs,
      random(),
    );
    const split = allocateDirections(a.questions.length);
    assert.equal(
      a.questions.filter((q) => q.direction === "en").length,
      split.en,
    );
    assert.equal(
      a.questions.filter((q) => q.direction === "zh").length,
      split.zh,
    );
    assert.ok(a.questions.slice(0, 7).some((q) => q.direction === "en"));
    for (const q of a.questions) {
      assert.equal(
        new Set(q.options.map((o) => o.label)).size,
        q.options.length,
      );
      assert.equal(q.options.filter((o) => o.id === q.correctId).length, 1);
      assert.ok(q.options.length >= 2);
    }
    const slots = a.questions.map((q) =>
      q.options.findIndex((o) => o.id === q.correctId),
    );
    assert.ok(new Set(slots).size >= Math.min(n, 4));
  }
});
test("high-priority bidirectional targets are separated without changing ratio", () => {
  const w = dataset(14);
  w.forEach((x) => (x.senses[0].highPriority = true));
  const u = w.map((w) => newUnit(w, w.senses[0], now));
  const a = generateAssessment(
    w,
    u,
    { count: 20, exam: "all", collectionId: "default", mode: "all" },
    prefs,
    random(),
  );
  assert.equal(a.questions.length, 20);
  let repeated = 0;
  for (let i = 0; i < a.questions.length; i++) {
    const j = a.questions.findIndex(
      (q, index) => index < i && q.unitId === a.questions[i].unitId,
    );
    if (j >= 0) {
      repeated++;
      assert.ok(i - j > 3);
      assert.notEqual(a.questions[i].direction, a.questions[j].direction);
    }
  }
  assert.ok(repeated > 0);
});
test("no frequency metadata means no forced bidirectional repetition", () => {
  const w = dataset(12);
  w.forEach((x) => (x.senses[0].highPriority = false));
  const u = w.map((w) => newUnit(w, w.senses[0], now));
  const a = generateAssessment(
    w,
    u,
    { count: 20, exam: "all", collectionId: "default", mode: "all" },
    prefs,
    random(),
  );
  assert.equal(a.questions.length, 12);
  assert.equal(new Set(a.questions.map((q) => q.unitId)).size, 12);
});
test("bookmarks, difficult and studied-only assessment scopes", () => {
  const w = dataset(20),
    u = w.map((w) => newUnit(w, w.senses[0], now));
  w.slice(0, 5).forEach((w) => (w.bookmark = 1));
  u.slice(5, 10).forEach((u) => (u.errors = 1));
  u.slice(10, 15).forEach((u) => (u.card.reps = 1));
  for (const [mode, studiedOnly, ids] of [
    ["bookmarks", false, w.slice(0, 5)],
    ["difficult", false, w.slice(5, 10)],
    ["all", true, w.slice(10, 15)],
  ]) {
    const a = generateAssessment(
      w,
      u,
      { count: 4, exam: "all", collectionId: "default", mode, studiedOnly },
      prefs,
      random(),
    );
    assert.ok(a.questions.every((q) => ids.some((w) => w.wordId === q.wordId)));
  }
});
test("ambiguous identical meanings and explicit synonyms cannot be distractors", () => {
  const w = dataset(5);
  w[1].senses[0].definitionZH = w[0].senses[0].definitionZH;
  w[2].senses[0].synonyms = [w[0].word];
  const u = w.map((w) => newUnit(w, w.senses[0], now));
  const a = generateAssessment(
    w,
    u,
    { count: 4, exam: "all", collectionId: "default", mode: "all" },
    prefs,
    random(),
  );
  const q = a.questions.find((q) => q.wordId === w[0].wordId);
  if (q) {
    assert.ok(!q.options.some((o) => o.id === u[1].unitId));
    assert.ok(!q.options.some((o) => o.id === u[2].unitId));
  }
});
test("grading assessment records accuracy/errors and never alters FSRS units", () => {
  const a = generateAssessment(
    words,
    units,
    { count: 20, exam: "all", collectionId: "default", mode: "all" },
    prefs,
    random(),
  );
  const before = JSON.stringify(units);
  a.answers = a.questions.map((q, i) =>
    assessmentAnswer(
      q,
      i === 0 ? q.options.find((o) => o.id !== q.correctId).id : q.correctId,
    ),
  );
  a.status = "completed";
  const r = assessmentResult(a);
  assert.equal(r.correct, 19);
  assert.equal(r.incorrect, 1);
  assert.equal(retryAssessment(a).questions.length, 1);
  assert.equal(JSON.stringify(units), before);
});
test("analytics uses events, distinct words and strict mastery; no fake zero-data accuracy", () => {
  const u = gradeUnit(units[0], 4, now).unit;
  const events = [
    {
      wordId: u.wordId,
      unitId: u.unitId,
      timestamp: now,
      isNewWord: true,
      previousState: 0,
    },
  ];
  const a = calculateAnalytics([u, ...units.slice(1)], events, [], prefs, now);
  assert.equal(a.todayNew, 1);
  assert.equal(a.studied, 1);
  assert.equal(a.mastered, 0);
  assert.equal(a.accuracy, null);
  assert.equal(a.streak, 1);
  assert.equal(a.trends.length, 30);
});
test("backup validation rejects unknown versions, missing stores and broken references", () => {
  assert.throws(() =>
    validateBackup({
      application: "stray-vocabulary",
      schemaVersion: 99,
      data: {},
    }),
  );
  assert.throws(() =>
    validateBackup({
      application: "stray-vocabulary",
      schemaVersion: 1,
      data: {},
    }),
  );
});

test("non-string words and definitions are not fabricated by coercion", () => {
  assert.equal(
    normalizeRecord({
      word: { bad: "value" },
      senses: [{ partOfSpeech: "noun", definitionEN: "a", definitionZH: "一" }],
    }).record,
    undefined,
  );
  assert.equal(
    normalizeRecord({
      word: "valid",
      senses: [
        {
          partOfSpeech: "noun",
          definitionEN: { bad: "value" },
          definitionZH: "一",
        },
      ],
    }).record,
    undefined,
  );
});
test("sparse single bookmarked target can produce one valid question with integer rounding", () => {
  const w = dataset(5),
    u = w.map((w) => newUnit(w, w.senses[0], now));
  w.forEach((w) => (w.senses[0].highPriority = false));
  w[0].bookmark = 1;
  const a = generateAssessment(
    w,
    u,
    { count: 20, exam: "all", collectionId: "default", mode: "bookmarks" },
    prefs,
    random(),
  );
  assert.equal(a.questions.length, 1);
  assert.equal(a.questions[0].direction, "zh");
  assert.equal(a.questions[0].wordId, w[0].wordId);
  assert.ok(a.questions[0].options.length >= 2);
});
test("combined ranking refuses incompatible corpus measurement units", () => {
  const s = {
    sourceOrder: 0,
    senseFrequency: { ...freq(10), ...freq(20, "CET-6", "incompatible") },
  };
  assert.equal(frequencyScore(s, "all"), null);
});
test("FSRS epoch-zero last review round-trips without being erased", () => {
  const u = gradeUnit(units[0], 3, 0).unit;
  assert.equal(u.card.last_review, 0);
  assert.doesNotThrow(() => preview(u, 600000));
});

test("analytics includes answered questions in paused assessments", () => {
  const a = generateAssessment(
    words,
    units,
    { count: 5, exam: "all", collectionId: "default", mode: "all" },
    prefs,
    random(),
  );
  a.answers = [assessmentAnswer(a.questions[0], a.questions[0].correctId)];
  const result = calculateAnalytics(units, [], [a], prefs, now);
  assert.equal(result.assessments, 0);
  assert.equal(result.questions, 1);
  assert.equal(result.accuracy, 1);
});
