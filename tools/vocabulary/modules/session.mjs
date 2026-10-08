import { dayKey, uid } from "./model.mjs";
export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function buildQueue({
  units,
  events,
  prefs,
  now = Date.now(),
  rng = Math.random,
  targetIds = null,
}) {
  const inScope = (u) =>
    (!prefs.collectionId || u.collectionIds.includes(prefs.collectionId)) &&
    (prefs.exam === "all" || u.examTags.includes(prefs.exam)) &&
    (!targetIds || targetIds.includes(u.wordId));
  const today = events.filter(
    (e) => dayKey(e.timestamp, prefs.timezone) === dayKey(now, prefs.timezone),
  );
  const learnedWords = new Set(
    today.filter((e) => e.isNewWord).map((e) => e.wordId),
  );
  const reviewedUnits = new Set(
    today.filter((e) => e.previousState === 2).map((e) => e.unitId),
  );
  const reviews = units
    .filter((u) => inScope(u) && u.state > 0 && u.due <= now)
    .sort(
      (a, b) =>
        a.due - b.due || (prefs.bookmarkPriority ? b.bookmark - a.bookmark : 0),
    );
  // Learning and relearning obligations remain eligible even when the review budget is exhausted.
  let allowance = Math.max(0, prefs.reviewLimit - reviewedUnits.size);
  const due = reviews.filter((u) => {
    if (u.state !== 2 || reviewedUnits.has(u.unitId)) return true;
    return allowance-- > 0;
  });
  let newAllowance = Math.max(0, prefs.newLimit - learnedWords.size);
  const knownWords = new Set(
    units.filter((u) => u.card.reps > 0).map((u) => u.wordId),
  );
  const newWords = new Set();
  const fresh = shuffle(
    units.filter((u) => inScope(u) && u.state === 0),
    rng,
  ).filter((u) => {
    if (
      knownWords.has(u.wordId) ||
      learnedWords.has(u.wordId) ||
      newWords.has(u.wordId)
    )
      return true;
    if (newAllowance <= 0) return false;
    newAllowance--;
    newWords.add(u.wordId);
    return true;
  });
  return spreadWords([...due, ...fresh].slice(0, prefs.sessionSize)).map(
    (u) => u.unitId,
  );
}
function spreadWords(units) {
  const out = [];
  const rest = [...units];
  while (rest.length) {
    let i = rest.findIndex((u) => u.wordId !== out.at(-1)?.wordId);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}
export function newSession(queue, prefs, now = Date.now(), targetIds = null) {
  return {
    id: "learning",
    sessionId: uid(),
    queue,
    index: 0,
    pending: [],
    completed: 0,
    day: dayKey(now, prefs.timezone),
    collectionId: prefs.collectionId,
    exam: prefs.exam,
    targetIds,
    lastWordId: null,
    createdAt: now,
  };
}
export function advanceSession(session, unit, now = Date.now()) {
  const next = structuredClone(session);
  next.index++;
  next.completed++;
  next.lastWordId = unit.wordId;
  next.pending = next.pending.filter((p) => p.unitId !== unit.unitId);
  if (unit.state === 1 || unit.state === 3)
    next.pending.push({
      unitId: unit.unitId,
      due: unit.due,
      wordId: unit.wordId,
    });
  next.pending.sort((a, b) => a.due - b.due);
  const ready = next.pending.filter(
    (p) => p.due <= now && !next.queue.slice(next.index).includes(p.unitId),
  );
  for (const p of ready) {
    next.queue.splice(
      next.index +
        (p.wordId === unit.wordId && next.index < next.queue.length ? 1 : 0),
      0,
      p.unitId,
    );
    next.pending = next.pending.filter((x) => x.unitId !== p.unitId);
  }
  return next;
}
export function releasePending(session, now = Date.now()) {
  const next = structuredClone(session);
  const ready = next.pending.filter((p) => p.due <= now);
  for (const p of ready) {
    if (!next.queue.slice(next.index).includes(p.unitId))
      next.queue.push(p.unitId);
  }
  next.pending = next.pending.filter((p) => p.due > now);
  return next;
}
