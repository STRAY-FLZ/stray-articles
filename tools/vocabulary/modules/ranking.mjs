// Rates are comparable only within the same annotation method and measurement.
export function frequencyScore(sense, exam = "all") {
  const entries = Object.entries(sense.senseFrequency || {}).filter(
    ([key, f]) =>
      (exam === "all" || key === exam) &&
      f.reliable === true &&
      f.level === "sense" &&
      f.sampleSize > 0,
  );
  if (new Set(entries.map(([, f]) => signature(f))).size > 1) return null;
  return entries.length
    ? entries.reduce(
        (sum, [, f]) => sum + (f.count / f.sampleSize) * 1000000,
        0,
      ) / entries.length
    : null;
}
function signature(f) {
  return `${f.methodology}|${f.measurement}`;
}
export function rankSenses(senses, exam = "all") {
  const original = [...senses].sort((a, b) => a.sourceOrder - b.sourceOrder);
  const selected = original.map((s) => ({
    s,
    entries: Object.entries(s.senseFrequency || {}).filter(
      ([key, f]) =>
        (exam === "all" || key === exam) && f.reliable && f.level === "sense",
    ),
  }));
  // Only reorder when every sense has the same evidence coverage and compatible units.
  const coverage = (e) =>
    e
      .map(([key, f]) => `${key}:${f.corpusId}:${signature(f)}`)
      .sort()
      .join(",");
  if (
    !selected.length ||
    selected.some(
      (e) =>
        !e.entries.length ||
        new Set(e.entries.map(([, f]) => signature(f))).size > 1,
    ) ||
    new Set(selected.map((e) => coverage(e.entries))).size !== 1
  )
    return original;
  return original.sort(
    (a, b) =>
      frequencyScore(b, exam) - frequencyScore(a, exam) ||
      a.sourceOrder - b.sourceOrder,
  );
}
export function isHighPriority(sense, exam, threshold) {
  return (
    sense.highPriority === true ||
    (frequencyScore(sense, exam) ?? -1) >= threshold
  );
}
export function representativeExample(sense, exam = "all") {
  return [...(sense.examples || [])].sort((a, b) => {
    const priority = (e) =>
      (({ exam: 0, news: 1, dictionary: 2, original: 3 })[e.sourceType] ?? 4) +
      (exam !== "all" && e.exam && e.exam !== exam ? 5 : 0);
    return priority(a) - priority(b);
  })[0];
}
