import {
  DEFAULTS,
  SCHEMA_VERSION,
  validatePreferences,
  uid,
  dayRange,
  canonical,
  senseIdentity,
} from "./model.mjs";
import { newUnit, gradeUnit } from "./scheduler.mjs";
import { advanceSession } from "./session.mjs";
import { assessmentAnswer } from "./assessment.mjs";
const STORES = [
  "collections",
  "words",
  "units",
  "events",
  "assessments",
  "sessions",
  "meta",
];
const KEYS = {
  collections: "id",
  words: "wordId",
  units: "unitId",
  events: "id",
  assessments: "id",
  sessions: "id",
  meta: "id",
};
export const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
function deriveWord(word, units) {
  return {
    ...word,
    studied: units.some((u) => u.card.reps > 0) ? 1 : 0,
    stateFlags: [...new Set(units.map((u) => u.state))],
    due: Math.min(
      ...units.filter((u) => u.state > 0).map((u) => u.due),
      Number.MAX_SAFE_INTEGER,
    ),
    difficult: units.some((u) => u.againCount > 0 || u.errors > 0) ? 1 : 0,
  };
}
export class VocabularyStore {
  constructor(profile = "local") {
    if (!/^[\w-]{1,40}$/.test(profile)) throw Error("本地档案标识无效");
    this.profile = profile;
    this.name = "stray-vocabulary-" + profile;
  }
  async open() {
    if (!globalThis.indexedDB)
      throw Error("浏览器不支持 IndexedDB，请使用现代浏览器并允许本地存储");
    const r = indexedDB.open(this.name, SCHEMA_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of STORES)
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: KEYS[name] });
      const tx = r.transaction;
      const index = (store, name, key, multiEntry = false) => {
        const s = tx.objectStore(store);
        if (!s.indexNames.contains(name))
          s.createIndex(name, key, { multiEntry });
      };
      for (const [name, key, multi] of [
        ["search", "search", false],
        ["collection", "collectionIds", true],
        ["exam", "examTags", true],
        ["bookmark", "bookmark", false],
        ["studied", "studied", false],
        ["state", "stateFlags", true],
        ["due", "due", false],
        ["difficult", "difficult", false],
      ])
        index("words", name, key, multi);
      for (const [name, key, multi] of [
        ["word", "wordId", false],
        ["collection", "collectionIds", true],
        ["exam", "examTags", true],
        ["state", "state", false],
        ["due", "due", false],
      ])
        index("units", name, key, multi);
      // v2: query actual due learning states without loading every New unit.
      index("units", "stateDue", ["state", "due"]);
      index("events", "time", "timestamp");
      index("events", "word", "wordId");
      index("events", "unit", "unitId");
      index("assessments", "created", "createdAt");
      index("assessments", "status", "status");
    };
    r.onblocked = () =>
      globalThis.dispatchEvent?.(new CustomEvent("vocabulary-blocked"));
    this.db = await request(r);
    this.db.onversionchange = () => {
      this.db.close();
      globalThis.dispatchEvent?.(new CustomEvent("vocabulary-blocked"));
    };
    await this.run(["collections", "meta"], "readwrite", async (s) => {
      if (!(await request(s.collections.get("default"))))
        s.collections.put({
          id: "default",
          name: "我的词库",
          createdAt: Date.now(),
        });
      if (!(await request(s.meta.get("preferences"))))
        s.meta.put({ id: "preferences", value: { ...DEFAULTS } });
    });
    return this;
  }
  close() {
    this.db?.close();
  }
  async run(names, mode, fn) {
    const tx = this.db.transaction(names, mode);
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error || Error("操作已取消，原有数据未覆盖"));
      tx.onerror = () => {};
    });
    const s = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    try {
      const result = await fn(s, tx);
      await completed;
      return result;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already have aborted. */
      }
      await completed.catch(() => {});
      throw e;
    }
  }
  get(store, id) {
    return this.run([store], "readonly", (s) => request(s[store].get(id)));
  }
  all(store, index = null, key = null) {
    return this.run([store], "readonly", (s) =>
      request(
        (index ? s[store].index(index) : s[store]).getAll(key ?? undefined),
      ),
    );
  }
  put(store, value) {
    return this.run([store], "readwrite", (s) => request(s[store].put(value)));
  }
  async preferences() {
    return validatePreferences((await this.get("meta", "preferences")).value);
  }
  async setPreferences(value) {
    return this.put("meta", {
      id: "preferences",
      value: validatePreferences(value),
    });
  }
  async createCollection(name) {
    name = String(name).trim();
    if (!name || name.length > 80) throw Error("词库名称需为 1–80 个字符");
    const c = { id: uid(), name, createdAt: Date.now() };
    await this.put("collections", c);
    return c;
  }
  async renameCollection(id, name) {
    const c = await this.get("collections", id);
    if (!c) throw Error("词库不存在");
    name = String(name).trim();
    if (!name || name.length > 80) throw Error("词库名称需为 1–80 个字符");
    await this.put("collections", { ...c, name });
  }
  async deleteCollection(id) {
    if (id === "default") throw Error("默认词库不可删除");
    return this.run(
      ["collections", "words", "units", "meta", "sessions"],
      "readwrite",
      async (s) => {
        const words = await request(s.words.index("collection").getAll(id));
        for (const word of words) {
          word.collectionIds = word.collectionIds.filter((c) => c !== id);
          if (!word.collectionIds.length) word.collectionIds = ["default"];
          s.words.put(word);
          const units = await request(
            s.units.index("word").getAll(word.wordId),
          );
          for (const u of units)
            s.units.put({ ...u, collectionIds: word.collectionIds });
        }
        s.collections.delete(id);
        const prefs = await request(s.meta.get("preferences"));
        if (prefs.value.collectionId === id)
          s.meta.put({
            ...prefs,
            value: { ...prefs.value, collectionId: "default" },
          });
        s.sessions.delete("learning");
      },
    );
  }
  async previewImport(records) {
    return this.run(["words"], "readonly", async (s) => {
      const known = new Set(await request(s.words.getAllKeys()));
      const seen = new Set();
      let duplicated = 0;
      const existingIds = new Set();
      for (const r of records) {
        if (known.has(r.wordId) || seen.has(r.wordId)) duplicated++;
        if (known.has(r.wordId)) existingIds.add(r.wordId);
        seen.add(r.wordId);
      }
      const ids = [...existingIds],
        oldWords = [];
      for (let i = 0; i < ids.length; i += 100)
        oldWords.push(
          ...(await Promise.all(
            ids.slice(i, i + 100).map((id) => request(s.words.get(id))),
          )),
        );
      const oldSenses = new Map(
        oldWords.map((w) => [
          w.wordId,
          new Set(w.senses.map((s) => s.senseId)),
        ]),
      );
      const additions = new Set();
      for (const r of records)
        if (oldSenses.has(r.wordId))
          for (const sense of r.senses)
            if (!oldSenses.get(r.wordId).has(sense.senseId))
              additions.add(`${r.wordId}:${sense.senseId}`);
      return {
        duplicated,
        newSenses: additions.size,
        newWords: [...seen].filter((id) => !known.has(id)).length,
      };
    });
  }

  async importRecords(
    records,
    collectionId,
    mode = "merge",
    metadata = {},
    onProgress = () => {},
  ) {
    if (!(await this.get("collections", collectionId)))
      throw Error("请选择现有词库");
    const batchId = uid();
    const totals = {
      imported: 0,
      merged: 0,
      skipped: 0,
      duplicated: 0,
      failed: 0,
      issues: [],
      batchId,
    };
    for (let i = 0; i < records.length; i += 100) {
      const chunk = records.slice(i, i + 100);
      const result = await this.run(
        ["words", "units", "collections"],
        "readwrite",
        async (s) => {
          if (!(await request(s.collections.get(collectionId))))
            throw Error("导入过程中词库已被删除");
          const counts = { imported: 0, merged: 0, skipped: 0, duplicated: 0 };
          const ids = [...new Set(chunk.map((r) => r.wordId))];
          const [existing, existingUnits] = await Promise.all([
            Promise.all(ids.map((id) => request(s.words.get(id)))),
            Promise.all(
              ids.map((id) => request(s.units.index("word").getAll(id))),
            ),
          ]);
          const wordCache = new Map(ids.map((id, i) => [id, existing[i]])),
            unitCache = new Map(ids.map((id, i) => [id, existingUnits[i]]));
          for (const record of chunk) {
            const old = wordCache.get(record.wordId);
            if (
              old &&
              (old.search !== record.search ||
                old.homographKey !== record.homographKey)
            )
              throw Error(
                "词条标识发生冲突，当前批次已回滚，请通过不同 homographKey 导入",
              );
            if (old) {
              counts.duplicated++;
              if (mode === "skip") {
                counts.skipped++;
                continue;
              }
            }
            const senses = old ? [...old.senses] : [];
            for (const incoming of record.senses) {
              const index = senses.findIndex(
                (x) => x.senseId === incoming.senseId,
              );
              if (index >= 0) {
                if (senseIdentity(senses[index]) !== senseIdentity(incoming))
                  throw Error("词义标识发生冲突，当前批次已回滚");
                senses[index] = {
                  ...senses[index],
                  ...incoming,
                  sourceOrder: senses[index].sourceOrder,
                  examples: incoming.examples.length
                    ? incoming.examples
                    : senses[index].examples,
                  senseFrequency: {
                    ...senses[index].senseFrequency,
                    ...incoming.senseFrequency,
                  },
                };
              } else senses.push({ ...incoming, sourceOrder: senses.length });
            }
            const word = {
              ...record,
              ...old,
              ipaUS: record.ipaUS || old?.ipaUS || "",
              audioUS: record.audioUS || old?.audioUS || "",
              senses,
              examTags: [
                ...new Set([...(old?.examTags || []), ...record.examTags]),
              ],
              partOfSpeech: [...new Set(senses.map((x) => x.partOfSpeech))],
              sourceMetadata: {
                ...old?.sourceMetadata,
                ...record.sourceMetadata,
              },
              collectionIds: [
                ...new Set([...(old?.collectionIds || []), collectionId]),
              ],
              importMetadata: [...(old?.importMetadata || [])],
            };
            // Repeated same file/source adds no redundant provenance entries.
            const origin = { ...metadata, batchId, importedAt: Date.now() };
            if (
              !word.importMetadata.some(
                (m) => m.fileHash && m.fileHash === metadata.fileHash,
              )
            )
              word.importMetadata.push(origin);
            const units = unitCache.get(word.wordId);
            for (const sense of senses) {
              let u = units.find((u) => u.senseId === sense.senseId);
              if (!u) {
                u = newUnit(word, sense);
                units.push(u);
              }
              u = {
                ...u,
                collectionIds: word.collectionIds,
                examTags: sense.examTags.length
                  ? sense.examTags
                  : word.examTags,
                bookmark: word.bookmark,
              };
              s.units.put(u);
            }
            const saved = deriveWord(word, units);
            s.words.put(saved);
            wordCache.set(word.wordId, saved);
            counts[old ? "merged" : "imported"]++;
          }
          return counts;
        },
      ).catch((e) => {
        totals.failed += chunk.length;
        totals.issues.push({
          location: `记录 ${i + 1}–${i + chunk.length}`,
          severity: "error",
          message: e.message,
        });
        return null;
      });
      if (result) for (const k of Object.keys(result)) totals[k] += result[k];
      onProgress({
        done: Math.min(i + 100, records.length),
        total: records.length,
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    return totals;
  }
  async bookmark(wordId) {
    return this.run(["words", "units"], "readwrite", async (s) => {
      const w = await request(s.words.get(wordId));
      if (!w) throw Error("词条不存在");
      w.bookmark = w.bookmark ? 0 : 1;
      s.words.put(w);
      const units = await request(s.units.index("word").getAll(wordId));
      for (const u of units) s.units.put({ ...u, bookmark: w.bookmark });
      return w.bookmark;
    });
  }
  async search({
    query = "",
    collectionId = "",
    exam = "all",
    status = "all",
    bookmarkOnly = false,
    page = 0,
    pageSize = 25,
  } = {}) {
    query = canonical(query);
    return this.run(["words"], "readonly", async (s) => {
      const queries = [];
      if (query)
        queries.push(
          request(
            s.words
              .index("search")
              .getAllKeys(IDBKeyRange.bound(query, query + "\uffff")),
          ),
        );
      if (collectionId)
        queries.push(
          request(s.words.index("collection").getAllKeys(collectionId)),
        );
      if (exam !== "all")
        queries.push(request(s.words.index("exam").getAllKeys(exam)));
      if (bookmarkOnly)
        queries.push(request(s.words.index("bookmark").getAllKeys(1)));
      if (status === "studied" || status === "new")
        queries.push(
          request(
            s.words.index("studied").getAllKeys(status === "studied" ? 1 : 0),
          ),
        );
      if (status === "difficult")
        queries.push(request(s.words.index("difficult").getAllKeys(1)));
      if (status === "due")
        queries.push(
          request(
            s.words.index("due").getAllKeys(IDBKeyRange.upperBound(Date.now())),
          ),
        );
      if (["1", "2", "3"].includes(status))
        queries.push(
          request(s.words.index("state").getAllKeys(Number(status))),
        );
      if (!queries.length)
        queries.push(request(s.words.index("search").getAllKeys()));
      const lists = await Promise.all(queries);
      lists.sort((a, b) => a.length - b.length);
      let ids = lists[0];
      for (const list of lists.slice(1)) {
        const set = new Set(list);
        ids = ids.filter((id) => set.has(id));
      }
      const items = await Promise.all(
        ids
          .slice(page * pageSize, (page + 1) * pageSize)
          .map((id) => request(s.words.get(id))),
      );
      return { items, total: ids.length, page, pageSize };
    });
  }

  due(now = Date.now()) {
    return this.run(["units"], "readonly", async (s) => {
      const groups = await Promise.all(
        [1, 2, 3].map((state) =>
          request(
            s.units
              .index("stateDue")
              .getAll(
                IDBKeyRange.bound(
                  [state, -Number.MAX_SAFE_INTEGER],
                  [state, now],
                ),
              ),
          ),
        ),
      );
      return groups.flat().sort((a, b) => a.due - b.due);
    });
  }

  todayEvents(now, timezone) {
    const { start, end } = dayRange(now, timezone);
    return this.all(
      "events",
      "time",
      IDBKeyRange.bound(start, end, false, true),
    );
  }
  async commitGrade({
    unitId,
    revision,
    rating,
    session,
    prefs,
    now = Date.now(),
    eventId = uid(),
  }) {
    return this.run(
      ["units", "words", "events", "sessions"],
      "readwrite",
      async (s) => {
        if (await request(s.events.get(eventId)))
          throw Error("该评分已保存，请勿重复提交");
        const u = await request(s.units.get(unitId));
        if (!u || u.revision !== revision)
          throw Error("该词义已在其他页面更新，请重新打开学习");
        const stored = await request(s.sessions.get("learning"));
        if (
          !stored ||
          stored.sessionId !== session.sessionId ||
          stored.index !== session.index ||
          stored.queue[stored.index] !== unitId
        )
          throw Error("学习会话已发生变化，请重新打开学习");
        const word = await request(s.words.get(u.wordId));
        if (u.state > 0 && u.due > now)
          throw Error("该词义尚未到期；目标练习也遵守 FSRS 到期时间");
        const { unit, log } = gradeUnit(u, rating, now, prefs.retention);
        s.units.put(unit);
        const related = await request(s.units.index("word").getAll(u.wordId));
        s.words.put(deriveWord(word, related));
        const event = {
          id: eventId,
          unitId,
          wordId: u.wordId,
          senseId: u.senseId,
          timestamp: now,
          rating,
          previousState: u.state,
          isNewWord: !word.studied,
          log,
          retention: prefs.retention,
        };
        s.events.add(event);
        const next = advanceSession(stored, unit, now);
        s.sessions.put(next);
        return { unit, event, session: next };
      },
    );
  }
  async submitAssessment(id, index, choiceId) {
    return this.run(
      ["assessments", "units", "words"],
      "readwrite",
      async (s) => {
        const a = await request(s.assessments.get(id));
        if (
          !a ||
          a.status !== "active" ||
          a.index !== index ||
          a.answers.length !== index
        )
          throw Error("题目已提交或检测已改变");
        const q = a.questions[index],
          answer = assessmentAnswer(q, choiceId);
        a.answers.push(answer);
        a.index++;
        if (a.index === a.questions.length) {
          a.status = "completed";
          a.completedAt = Date.now();
        }
        s.assessments.put(a);
        if (!answer.correct) {
          const unit = await request(s.units.get(q.unitId));
          if (unit) {
            s.units.put({ ...unit, errors: unit.errors + 1 });
            const w = await request(s.words.get(q.wordId));
            if (w) s.words.put({ ...w, difficult: 1 });
          }
        }
        return a;
      },
    );
  }
  async backup() {
    return this.run(STORES, "readonly", async (s) => {
      const data = {};
      for (const name of STORES) data[name] = await request(s[name].getAll());
      return {
        application: "stray-vocabulary",
        schemaVersion: SCHEMA_VERSION,
        profile: this.profile,
        exportedAt: Date.now(),
        data,
      };
    });
  }
  async restore(backup) {
    validateBackup(backup);
    const grouped = new Map();
    for (const u of backup.data.units) {
      if (!grouped.has(u.wordId)) grouped.set(u.wordId, []);
      grouped.get(u.wordId).push(u);
    }
    return this.run(STORES, "readwrite", async (s) => {
      for (const name of STORES) {
        s[name].clear();
        for (const row of backup.data[name])
          s[name].put(
            name === "words"
              ? deriveWord(row, grouped.get(row.wordId) || [])
              : row,
          );
      }
    });
  }
}
export function validateBackup(b) {
  if (
    !b ||
    b.application !== "stray-vocabulary" ||
    ![1, SCHEMA_VERSION].includes(b.schemaVersion) ||
    !b.data
  )
    throw Error("备份格式或版本不受支持");
  for (const name of STORES) {
    if (!Array.isArray(b.data[name])) throw Error(`备份缺少 ${name}`);
    const ids = new Set();
    for (const r of b.data[name]) {
      const id = r?.[KEYS[name]];
      if (typeof id !== "string" || !id || ids.has(id))
        throw Error(`备份 ${name} 标识无效或重复`);
      ids.add(id);
    }
  }
  const d = b.data,
    collections = new Set(d.collections.map((c) => c.id));
  if (!collections.has("default")) throw Error("备份缺少默认词库");
  for (const c of d.collections)
    if (typeof c.name !== "string" || !c.name.trim())
      throw Error("词库名称无效");
  const words = new Map(d.words.map((w) => [w.wordId, w])),
    units = new Map(d.units.map((u) => [u.unitId, u]));
  for (const w of words.values()) {
    if (
      typeof w.word !== "string" ||
      !w.word ||
      w.search !== canonical(w.word) ||
      !Array.isArray(w.senses) ||
      !w.senses.length ||
      !Array.isArray(w.collectionIds) ||
      w.collectionIds.some((id) => !collections.has(id)) ||
      !Array.isArray(w.examTags) ||
      ![0, 1].includes(w.bookmark)
    )
      throw Error("备份词条结构或词库引用无效");
    const seen = new Set();
    for (const s of w.senses) {
      if (
        typeof s.senseId !== "string" ||
        !s.senseId ||
        seen.has(s.senseId) ||
        typeof s.definitionEN !== "string" ||
        !s.definitionEN ||
        typeof s.definitionZH !== "string" ||
        !s.definitionZH ||
        typeof s.partOfSpeech !== "string" ||
        !s.partOfSpeech ||
        !Array.isArray(s.examples) ||
        !Array.isArray(s.examTags)
      )
        throw Error("备份词义无效");
      seen.add(s.senseId);
      if (!units.has(`${w.wordId}:${s.senseId}`))
        throw Error("备份词义缺少对应记忆单元");
    }
  }
  for (const u of units.values()) {
    const w = words.get(u.wordId),
      c = u.card;
    if (
      !w ||
      !w.senses.some((s) => s.senseId === u.senseId) ||
      u.unitId !== `${u.wordId}:${u.senseId}` ||
      !c ||
      ![0, 1, 2, 3].includes(c.state) ||
      c.state !== u.state ||
      !Number.isFinite(c.due) ||
      !Number.isFinite(new Date(c.due).getTime()) ||
      c.due !== u.due ||
      !Number.isInteger(u.revision) ||
      u.revision < 0 ||
      !Array.isArray(u.collectionIds) ||
      u.collectionIds.slice().sort().join("|") !==
        w.collectionIds.slice().sort().join("|")
    )
      throw Error("备份记忆状态或关联无效");
    for (const k of [
      "stability",
      "difficulty",
      "elapsed_days",
      "scheduled_days",
      "reps",
      "lapses",
      "learning_steps",
    ])
      if (!Number.isFinite(c[k]) || c[k] < 0) throw Error(`FSRS ${k} 无效`);
    if (
      c.state > 0 &&
      (c.difficulty < 1 ||
        c.stability <= 0 ||
        c.reps < 1 ||
        !Number.isFinite(c.last_review))
    )
      throw Error("已学习词义的 FSRS 记忆状态无效");
    if (
      c.difficulty > 10 ||
      ![u.errors, u.againCount].every((n) => Number.isInteger(n) && n >= 0) ||
      (c.last_review !== null && !Number.isFinite(c.last_review))
    )
      throw Error("FSRS 时间或错误计数无效");
  }
  for (const e of d.events)
    if (
      !units.has(e.unitId) ||
      units.get(e.unitId).wordId !== e.wordId ||
      ![1, 2, 3, 4].includes(e.rating) ||
      !Number.isFinite(e.timestamp) ||
      !Number.isFinite(new Date(e.timestamp).getTime())
    )
      throw Error("备份学习事件引用无效");
  for (const a of d.assessments) {
    if (
      !["active", "completed"].includes(a.status) ||
      !Array.isArray(a.questions) ||
      !a.questions.length ||
      !Number.isFinite(a.createdAt) ||
      !Array.isArray(a.answers) ||
      a.index !== a.answers.length ||
      a.index > a.questions.length
    )
      throw Error("备份检测状态无效");
    for (const q of a.questions) {
      if (
        !units.has(q.unitId) ||
        q.wordId !== units.get(q.unitId).wordId ||
        q.senseId !== units.get(q.unitId).senseId ||
        q.correctId !== q.unitId ||
        !["en", "zh"].includes(q.direction) ||
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.some(
          (o) =>
            !units.has(o.id) || typeof o.label !== "string" || !o.label.trim(),
        ) ||
        new Set(q.options.map((o) => o.id)).size !== q.options.length ||
        !q.options.some((o) => o.id === q.correctId)
      )
        throw Error("备份检测题目无效");
    }
    a.answers.forEach((answer, i) => {
      const q = a.questions[i];
      if (
        answer.questionId !== q.id ||
        answer.unitId !== q.unitId ||
        answer.wordId !== q.wordId ||
        answer.senseId !== q.senseId ||
        !Number.isFinite(answer.timestamp) ||
        !q.options.some((o) => o.id === answer.choiceId) ||
        answer.correct !== (answer.choiceId === q.correctId)
      )
        throw Error("备份检测答案无效");
    });
    if (a.status === "completed" && a.index !== a.questions.length)
      throw Error("已完成检测题数不符");
  }
  for (const s of d.sessions) {
    if (
      s.id !== "learning" ||
      !Array.isArray(s.queue) ||
      !Array.isArray(s.pending) ||
      s.queue.some((id) => !units.has(id)) ||
      s.pending.some((p) => !units.has(p.unitId) || !Number.isFinite(p.due)) ||
      !Number.isInteger(s.index) ||
      s.index < 0 ||
      s.index > s.queue.length
    )
      throw Error("备份学习会话无效");
  }
  const prefs = d.meta.find((m) => m.id === "preferences");
  if (!prefs) throw Error("备份缺少设置");
  validatePreferences(prefs.value);
  if (!collections.has(prefs.value.collectionId))
    throw Error("设置引用未知词库");
  return true;
}
