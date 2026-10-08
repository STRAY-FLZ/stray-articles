import { canonical, uid } from "./model.mjs";
import { shuffle } from "./session.mjs";
import { isHighPriority } from "./ranking.mjs";
export const allocateDirections = (n) => ({
  en: Math.round(n * 0.3),
  zh: n - Math.round(n * 0.3),
});
function ambiguous(a, b) {
  if (
    a.word.wordId === b.word.wordId ||
    canonical(a.word.word) === canonical(b.word.word)
  )
    return true;
  const left = a.sense,
    right = b.sense;
  const meanings = (s) =>
    new Set(
      [
        canonical(s.definitionZH),
        canonical(s.definitionEN),
        ...String(s.definitionZH)
          .split(/[;；、，,]/)
          .map(canonical),
      ].filter(Boolean),
    );
  const l = meanings(left),
    r = meanings(right);
  return (
    [...l].some((x) => r.has(x)) ||
    left.synonyms?.includes(canonical(b.word.word)) ||
    right.synonyms?.includes(canonical(a.word.word))
  );
}
export function generateAssessment(
  words,
  units,
  settings,
  prefs,
  rng = Math.random,
) {
  const unitMap = new Map(units.map((u) => [u.unitId, u]));
  const pool = [];
  for (const word of words) {
    if (
      settings.collectionId &&
      !word.collectionIds.includes(settings.collectionId)
    )
      continue;
    for (const sense of word.senses) {
      const unit = unitMap.get(`${word.wordId}:${sense.senseId}`);
      if (!unit) continue;
      if (
        settings.exam !== "all" &&
        !word.examTags.includes(settings.exam) &&
        !sense.examTags.includes(settings.exam)
      )
        continue;
      pool.push({ word, sense, unit });
    }
  }
  const targets = pool.filter(
    (x) =>
      (!settings.targetIds || settings.targetIds.includes(x.word.wordId)) &&
      (!settings.studiedOnly || x.unit.card.reps > 0) &&
      (settings.mode !== "bookmarks" || x.word.bookmark) &&
      (settings.mode !== "difficult" || x.unit.errors || x.unit.againCount),
  );
  const candidates = shuffle(targets, rng)
    .sort(
      (a, b) =>
        Number(
          isHighPriority(b.sense, settings.exam, prefs.highFrequencyThreshold),
        ) -
        Number(
          isHighPriority(a.sense, settings.exam, prefs.highFrequencyThreshold),
        ),
    )
    .filter((a) =>
      pool.some(
        (b) =>
          b.sense.partOfSpeech === a.sense.partOfSpeech && !ambiguous(a, b),
      ),
    );
  if (!candidates.length)
    throw Error(
      "当前范围中不足两个可区分且词性匹配的词义，无法生成有效检测。请导入更多词条或调整范围。",
    );
  const max =
    candidates.length +
    candidates.filter((x) =>
      isHighPriority(x.sense, settings.exam, prefs.highFrequencyThreshold),
    ).length;
  let total = Math.min(settings.count, max);
  let generated = [];
  // Retry with a shorter, valid total if directional availability or spacing is insufficient.
  while (total >= 1) {
    const allocation = allocateDirections(total);
    let enTargets = candidates.slice(0, allocation.en);
    const usedEn = new Set(enTargets.map((x) => x.unit.unitId));
    const zhTargets = [
      ...enTargets.filter((x) =>
        isHighPriority(x.sense, settings.exam, prefs.highFrequencyThreshold),
      ),
      ...candidates.filter((x) => !usedEn.has(x.unit.unitId)),
    ].slice(0, allocation.zh);
    if (zhTargets.length < allocation.zh) {
      total--;
      continue;
    }
    const en = shuffle(
      enTargets.map((x) => ({ target: x, direction: "en" })),
      rng,
    );
    const zh = shuffle(
      zhTargets.map((x) => ({ target: x, direction: "zh" })),
      rng,
    );
    const order = [];
    let possible = true;
    for (let i = 0; i < total; i++) {
      const preferEn = Math.round((i + 1) * 0.3) > Math.round(i * 0.3);
      const first = preferEn ? en : zh,
        second = preferEn ? zh : en;
      const gap = Math.min(3, Math.max(1, Math.floor(total / 5)));
      const safe = (q) =>
        !order
          .slice(-gap)
          .some((p) => p.target.word.wordId === q.target.word.wordId);
      let list = first,
        index = list.findIndex(safe);
      if (index < 0) {
        list = second;
        index = list.findIndex(safe);
      }
      if (index < 0) {
        possible = false;
        break;
      }
      order.push(list.splice(index, 1)[0]);
    }
    if (!possible) {
      total--;
      continue;
    }
    const positions = [0, 0, 0, 0];
    generated = order.map(({ target, direction }, i) =>
      makeQuestion(target, direction, pool, i, rng, positions),
    );
    break;
  }
  if (!generated.length)
    throw Error("可用词义无法满足题型比例及重复间隔，请扩大检测范围。");
  return {
    id: uid(),
    status: "active",
    createdAt: Date.now(),
    settings,
    requested: settings.count,
    questions: generated,
    answers: [],
    index: 0,
    allocation: allocateDirections(generated.length),
    completedAt: null,
  };
}
function makeQuestion(target, direction, pool, _index, rng, positions) {
  const candidates = shuffle(
    pool.filter(
      (b) =>
        b.sense.partOfSpeech === target.sense.partOfSpeech &&
        !ambiguous(target, b),
    ),
    rng,
  ).sort(
    (a, b) =>
      Number(b.sense.semanticCategory === target.sense.semanticCategory) -
      Number(a.sense.semanticCategory === target.sense.semanticCategory),
  );
  const label = (x) =>
    direction === "en" ? x.sense.definitionZH : x.word.word;
  const options = [{ id: target.unit.unitId, label: label(target) }];
  for (const x of candidates) {
    if (options.some((o) => canonical(o.label) === canonical(label(x))))
      continue;
    options.push({ id: x.unit.unitId, label: label(x) });
    if (options.length === 4) break;
  }
  // Balance correct-answer positions without making their sequence predictable.
  const min = Math.min(...positions.slice(0, options.length));
  const slots = positions
    .slice(0, options.length)
    .map((v, i) => (v === min ? i : -1))
    .filter((i) => i >= 0);
  const slot = slots[Math.floor(rng() * slots.length)];
  positions[slot]++;
  const wrong = shuffle(options.slice(1), rng);
  wrong.splice(slot, 0, options[0]);
  return {
    id: uid(),
    unitId: target.unit.unitId,
    wordId: target.word.wordId,
    senseId: target.sense.senseId,
    word: target.word.word,
    partOfSpeech: target.sense.partOfSpeech,
    definitionEN: target.sense.definitionEN,
    definitionZH: target.sense.definitionZH,
    direction,
    options: wrong,
    correctId: target.unit.unitId,
    context:
      direction === "en"
        ? target.sense.examples?.[0]?.sentence ||
          `目标词义：${target.sense.definitionEN}`
        : "",
    source:
      target.sense.examples?.[0]?.exampleSource ||
      target.sense.dictionarySource,
  };
}
export function assessmentAnswer(question, choiceId) {
  if (!question.options.some((o) => o.id === choiceId))
    throw Error("请选择有效选项");
  return {
    questionId: question.id,
    unitId: question.unitId,
    wordId: question.wordId,
    senseId: question.senseId,
    direction: question.direction,
    choiceId,
    correct: choiceId === question.correctId,
    timestamp: Date.now(),
  };
}
export function assessmentResult(a) {
  const accuracy = (arr) =>
    arr.length ? arr.filter((x) => x.correct).length / arr.length : null;
  const correct = a.answers.filter((x) => x.correct).length;
  return {
    total: a.answers.length,
    correct,
    incorrect: a.answers.length - correct,
    accuracy: accuracy(a.answers),
    en: accuracy(a.answers.filter((x) => x.direction === "en")),
    zh: accuracy(a.answers.filter((x) => x.direction === "zh")),
    missed: a.answers
      .filter((x) => !x.correct)
      .map((answer) => ({
        answer,
        question: a.questions.find((q) => q.id === answer.questionId),
      })),
  };
}
export function retryAssessment(a) {
  const missed = assessmentResult(a).missed.map((x) => ({
    ...x.question,
    id: uid(),
  }));
  if (!missed.length) throw Error("本次没有错题");
  return {
    id: uid(),
    status: "active",
    createdAt: Date.now(),
    settings: { ...a.settings, mode: "retry" },
    requested: missed.length,
    questions: missed,
    answers: [],
    index: 0,
    allocation: {
      en: missed.filter((x) => x.direction === "en").length,
      zh: missed.filter((x) => x.direction === "zh").length,
    },
    completedAt: null,
  };
}
