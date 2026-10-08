import { dayKey } from "./model.mjs";
import { retrievability } from "./scheduler.mjs";
import { assessmentResult } from "./assessment.mjs";
export function calculateAnalytics(
  units,
  events,
  assessments,
  prefs,
  now = Date.now(),
) {
  const today = dayKey(now, prefs.timezone),
    studied = new Set(
      units.filter((u) => u.card.reps > 0).map((u) => u.wordId),
    );
  const todays = events.filter(
    (e) => dayKey(e.timestamp, prefs.timezone) === today,
  );
  const byWord = new Map();
  for (const u of units) {
    if (!byWord.has(u.wordId)) byWord.set(u.wordId, []);
    byWord.get(u.wordId).push(u);
  }
  const mastered = [...byWord.values()].filter((us) =>
    us.every(
      (u) =>
        u.state === 2 &&
        u.card.stability >= 30 &&
        u.card.reps >= 3 &&
        retrievability(u, now, prefs.retention) >= prefs.retention,
    ),
  ).length;
  const eventDays = new Map();
  for (const e of events) {
    const key = dayKey(e.timestamp, prefs.timezone);
    if (!eventDays.has(key)) eventDays.set(key, []);
    eventDays.get(key).push(e);
  }
  const studyDays = new Set(eventDays.keys());
  const offset = (key, n) => {
    const d = new Date(key + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let streak = 0,
    key = studyDays.has(today) ? today : offset(today, -1);
  while (studyDays.has(key)) {
    streak++;
    key = offset(key, -1);
  }
  const trends = Array.from({ length: 30 }, (_, i) => {
    const date = offset(today, i - 29);
    const ev = eventDays.get(date) || [];
    return {
      date,
      newWords: new Set(ev.filter((e) => e.isNewWord).map((e) => e.wordId))
        .size,
      reviews: ev.filter((e) => e.previousState > 0).length,
    };
  });
  const completed = assessments.filter((a) => a.status === "completed");
  const answers = assessments.flatMap((a) => a.answers);
  const answerDays = new Map();
  for (const a of answers) {
    const key = dayKey(a.timestamp, prefs.timezone);
    if (!answerDays.has(key)) answerDays.set(key, []);
    answerDays.get(key).push(a);
  }
  const directional = (d) => {
    const v = answers.filter((a) => a.direction === d);
    return v.length ? v.filter((a) => a.correct).length / v.length : null;
  };
  const dueUnits = units.filter((u) => u.state > 0 && u.due <= now);
  const errors = new Map();
  for (const a of answers.filter((a) => !a.correct))
    errors.set(a.unitId, (errors.get(a.unitId) || 0) + 1);
  return {
    todayNew: new Set(todays.filter((e) => e.isNewWord).map((e) => e.wordId))
      .size,
    todayReviews: todays.filter((e) => e.previousState > 0).length,
    todayReviewedWords: new Set(
      todays.filter((e) => e.previousState > 0).map((e) => e.wordId),
    ).size,
    studied: studied.size,
    totalEvents: events.length,
    reviewEvents: events.filter((e) => e.previousState > 0).length,
    wordCount: byWord.size,
    unitCount: units.length,
    mastered,
    dueWords: new Set(dueUnits.map((u) => u.wordId)).size,
    dueUnits: dueUnits.length,
    states: [0, 1, 2, 3].map((s) => units.filter((u) => u.state === s).length),
    streak,
    trends,
    assessments: completed.length,
    questions: answers.length,
    accuracy: answers.length
      ? answers.filter((a) => a.correct).length / answers.length
      : null,
    en: directional("en"),
    zh: directional("zh"),
    scores: completed.map((a) => ({
      id: a.id,
      date: a.completedAt,
      ...assessmentResult(a),
    })),
    frequentErrors: [...errors].sort((a, b) => b[1] - a[1]).slice(0, 20),
    errorTrend: Array.from({ length: 30 }, (_, i) => {
      const date = offset(today, i - 29);
      const a = answerDays.get(date) || [];
      return {
        date,
        total: a.length,
        errors: a.filter((x) => !x.correct).length,
      };
    }),
  };
}
