import {
  fsrs,
  createEmptyCard,
  State,
  Rating,
  FSRSVersion,
} from "../vendor/ts-fsrs.mjs";
export { State, Rating };
export const ENGINE = {
  library: "ts-fsrs",
  version: "5.4.2",
  algorithm: FSRSVersion,
};
const engines = new Map();
export function scheduler(retention = 0.9) {
  if (!engines.has(retention))
    engines.set(
      retention,
      fsrs({
        request_retention: retention,
        maximum_interval: 36500,
        enable_fuzz: false,
        enable_short_term: true,
        learning_steps: ["1m", "10m"],
        relearning_steps: ["10m"],
      }),
    );
  return engines.get(retention);
}
export const packCard = (c) => ({
  ...c,
  due: +c.due,
  last_review: c.last_review ? +c.last_review : null,
});
export const unpackCard = (c) => ({
  ...c,
  due: new Date(c.due),
  last_review:
    c.last_review !== null && c.last_review !== undefined
      ? new Date(c.last_review)
      : undefined,
});
export function newUnit(word, sense, now = Date.now()) {
  return {
    unitId: `${word.wordId}:${sense.senseId}`,
    wordId: word.wordId,
    senseId: sense.senseId,
    collectionIds: word.collectionIds,
    examTags: sense.examTags.length ? sense.examTags : word.examTags,
    card: packCard(createEmptyCard(new Date(now))),
    due: now,
    state: 0,
    revision: 0,
    errors: 0,
    againCount: 0,
    bookmark: word.bookmark,
  };
}
export function preview(unit, now = Date.now(), retention = 0.9) {
  return scheduler(retention).repeat(unpackCard(unit.card), new Date(now));
}
export function gradeUnit(unit, rating, now = Date.now(), retention = 0.9) {
  if (![1, 2, 3, 4].includes(rating)) throw Error("无效记忆评分");
  if (
    unit.card.last_review !== null &&
    unit.card.last_review !== undefined &&
    now < unit.card.last_review
  )
    throw Error("设备时间早于上次学习时间，请校准系统时钟");
  const result = scheduler(retention).next(
    unpackCard(unit.card),
    new Date(now),
    rating,
  );
  return {
    unit: {
      ...unit,
      card: packCard(result.card),
      due: +result.card.due,
      state: result.card.state,
      revision: unit.revision + 1,
      againCount: unit.againCount + (rating === 1 ? 1 : 0),
    },
    log: { ...result.log, due: +result.log.due, review: +result.log.review },
  };
}
export function retrievability(unit, now = Date.now(), retention = 0.9) {
  return scheduler(retention).get_retrievability(
    unpackCard(unit.card),
    new Date(now),
    false,
  );
}
export function intervalLabel(due, now = Date.now()) {
  const seconds = Math.max(0, (+due - now) / 1000);
  return seconds < 60
    ? "不足 1 分钟"
    : seconds < 3600
      ? `${Math.round(seconds / 60)} 分钟`
      : seconds < 86400
        ? `${Math.round(seconds / 3600)} 小时`
        : `${Math.round(seconds / 86400)} 天`;
}
