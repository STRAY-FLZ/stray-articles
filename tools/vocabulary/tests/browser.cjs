/* Actual Chromium/IndexedDB integration, UI workflow and 10,000-entry benchmark. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const assert = require("node:assert/strict");
const appRoot = path.resolve(__dirname, ".."),
  repo = path.resolve(appRoot, "../..");
const artifacts =
  process.env.VOCABULARY_ARTIFACT_DIR ||
  path.join(os.tmpdir(), "stray-vocabulary-qa");
fs.mkdirSync(artifacts, { recursive: true });
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  let url = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  ).replace(/^\/stray-articles(?=\/)/, "");
  let file = path.resolve(repo, "." + url);
  if (!file.startsWith(repo + path.sep) || url.includes("/.git")) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory())
    file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
    } else {
      res.setHeader(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      res.end(data);
    }
  });
});
let debugPage;
let checks = 0;
const metrics = {};
const check = (label, value) => {
  assert.ok(value, label);
  checks++;
  console.log("PASS " + label);
};
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/stray-articles/tools/vocabulary/`;
  const profilePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "stray-vocabulary-browser-"),
  );
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    viewport: { width: 1365, height: 900 },
    acceptDownloads: true,
  });
  const _browser = context.browser();
  const page = await context.newPage();
  debugPage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon"))
      errors.push(m.text());
  });
  const route = async (hash) => {
    const response = await page.goto(base + hash);
    if (!response) await page.reload();
    await page.locator("#view h1").waitFor();
  };
  await route("#home");
  check(
    "homepage three functional routes",
    (await page.locator(".entry-grid a").count()) === 3,
  );
  check(
    "onboarding without vocabulary",
    await page.getByText("从你的第一份词库开始").isVisible(),
  );
  await page.locator('a[href="#import"]').click();
  await page.locator("#vocab-file").waitFor();
  const { DEMO_TEXT } = await import("../modules/export-spec.mjs");
  await page.locator("#vocab-file").setInputFiles({
    name: "glm-demo.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("\ufeff" + DEMO_TEXT.replace(/\n/g, "\r\n")),
  });
  await page.locator('[data-action="import-save"]').waitFor();
  check(
    "worker import preview before persistence",
    await page
      .locator("#import-preview")
      .textContent()
      .then((t) => t.includes("6 条可导入")),
  );
  await page.locator('[data-action="import-save"]').click();
  await page.getByText(/导入完成：新增 6/).waitFor();
  await route("#learn");
  check(
    "definitions initially hidden and ratings disabled",
    (await page.locator(".answer").count()) === 0 &&
      (await page.locator('[data-rating="3"]').isDisabled()),
  );
  await page.keyboard.press("Space");
  await page.locator(".answer").waitFor();
  check(
    "space reveals and enables genuine rating previews",
    !(await page.locator('[data-rating="3"]').isDisabled()),
  );
  await page.locator('[data-action="bookmark"]').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-action="bookmark"]')
        ?.getAttribute("aria-pressed") === "true",
  );
  check(
    "bookmark immediate persistence and highlight",
    (await page
      .locator('[data-action="bookmark"]')
      .getAttribute("aria-pressed")) === "true",
  );
  const firstWord = await page.locator(".word").textContent();
  const start = Date.now();
  await page.locator('[data-rating="3"]').click();
  await page.waitForFunction(
    (old) => document.querySelector(".word")?.textContent !== old,
    firstWord,
    { timeout: 5000 },
  );
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-action="reveal"]');
    return b && !b.disabled;
  });
  metrics.flashcardUiMs = Date.now() - start;
  const db = async (fn) => page.evaluate(fn);
  let snapshot = await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const s = await new VocabularyStore().open();
    const b = await s.backup();
    s.close();
    return b;
  });
  check(
    "grading creates one event and one meaning schedule",
    snapshot.data.events.length === 1 &&
      snapshot.data.units.filter((u) => u.card.reps > 0).length === 1,
  );
  check(
    "bookmark independent of grading",
    snapshot.data.words.some((w) => w.word === firstWord && w.bookmark === 1),
  );
  const nextWord = await page.locator(".word").textContent();
  await page.locator('[data-action="pause"]').click();
  await page.locator(".intro h1").waitFor();
  await page.locator('a[data-nav="learn"]').click();
  await page.locator(".word").waitFor();
  check(
    "pause and resume keep current card",
    (await page.locator(".word").textContent()) === nextWord,
  );
  const savedSchedule = JSON.stringify(
    snapshot.data.units.find((u) => u.card.reps > 0).card,
  );
  await route("#import");
  await page.locator('[data-action="demo-preview"]').click();
  await page.locator('[data-action="import-save"]').waitFor();
  await page.locator('[data-action="import-save"]').click();
  await page.getByText(/导入完成：新增 0，合并 6/).waitFor();
  snapshot = await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const s = await new VocabularyStore().open();
    const b = await s.backup();
    s.close();
    return b;
  });
  check(
    "reimport deduplicates and preserves memory state",
    snapshot.data.words.length === 6 &&
      JSON.stringify(snapshot.data.units.find((u) => u.card.reps > 0).card) ===
        savedSchedule,
  );
  await route("#library");
  await page.locator('[data-action="detail"]').first().click();
  await page.locator("#word-detail .panel").waitFor();
  check(
    "word detail and meaning review history",
    await page
      .locator("#word-detail")
      .textContent()
      .then((t) => t.includes("词义学习状态与下次复习")),
  );
  await page.locator('input[name="query"]').fill("rec");
  await page.waitForTimeout(300);
  check(
    "indexed prefix search",
    (await page.locator(".word-row").count()) === 1,
  );
  await page.locator('input[name="query"]').fill("");
  await page.waitForTimeout(300);
  page.once("dialog", (d) => d.accept("UI 测试词库"));
  await page.locator('[data-action="create-collection"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('select[name="collectionId"]')?.selectedOptions[0]
        ?.textContent === "UI 测试词库",
  );
  check("UI collection creation and active switch", true);
  page.once("dialog", (d) => d.accept("UI 重命名词库"));
  await page.locator('[data-action="rename-collection"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('select[name="collectionId"]')?.selectedOptions[0]
        ?.textContent === "UI 重命名词库",
  );
  check("UI collection rename", true);
  await page.locator('select[name="collectionId"]').selectOption("default");
  await page.waitForFunction(
    () => document.querySelectorAll(".word-row").length === 6,
  );
  check("UI collection filtering and switch", true);
  await page
    .locator('select[name="collectionId"]')
    .selectOption({ label: "UI 重命名词库" });
  await page.waitForFunction(
    () => document.querySelectorAll(".word-row").length === 0,
  );
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-action="delete-collection"]').click();
  await page.waitForFunction(
    () =>
      !Array.from(
        document.querySelectorAll('select[name="collectionId"] option'),
      ).some((o) => o.textContent === "UI 重命名词库"),
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".word-row").length === 6,
  );
  check(
    "UI collection deletion preserves shared vocabulary",
    (await page.locator(".word-row").count()) === 6,
  );
  await route("#assessment");
  await page.locator('#assessment-settings button[type="submit"]').click();
  await page.locator("#answer-form").waitFor();
  let answerCount = 0;
  while (await page.locator('#answer-form button[type="submit"]').count()) {
    await page.locator("#answer-form input").first().check();
    await page.locator('#answer-form button[type="submit"]').click();
    await page.locator(".feedback").waitFor();
    answerCount++;
    await page.locator('[data-action="next"]').click();
    if ((await page.locator("h1").textContent()) === "检测结果") break;
  }
  check(
    "full mixed assessment and persisted results",
    answerCount >= 2 && (await page.locator("h1").textContent()) === "检测结果",
  );
  snapshot = await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const s = await new VocabularyStore().open();
    const b = await s.backup();
    s.close();
    return b;
  });
  const a = snapshot.data.assessments.find((a) => a.status === "completed");
  check(
    "actual 30/70 allocation",
    a.questions.filter((q) => q.direction === "en").length ===
      Math.round(a.questions.length * 0.3),
  );
  check(
    "assessment did not extend FSRS or create recall events",
    snapshot.data.events.length === 1 &&
      JSON.stringify(snapshot.data.units.find((u) => u.card.reps > 0).card) ===
        savedSchedule,
  );
  if (a.answers.some((a) => !a.correct)) {
    await page.locator('[data-action="retry"]').click();
    await page.locator("#answer-form").waitFor();
    check("immediate missed-question retry functional", true);
  }
  await route("#analytics");
  check(
    "analytics real record counts and trend tables",
    await page
      .locator("#view")
      .textContent()
      .then(
        (t) => t.includes("学习评分事件") && t.includes("近 30 天学习趋势"),
      ),
  );
  await route("#settings");
  const downloaded = page.waitForEvent("download");
  await page.locator('[data-action="backup"]').click();
  const download = await downloaded;
  const backupPath = path.join(artifacts, "workflow-backup.json");
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  check(
    "one-click backup includes all stores",
    Object.keys(backup.data).length === 7,
  );
  await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const s = await new VocabularyStore().open();
    await s.createCollection("temporary");
    s.close();
  });
  page.once("dialog", (d) => d.accept());
  await page.locator("#restore-file").setInputFiles(backupPath);
  await page.getByText("备份已完整恢复").waitFor();
  const restored = await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const s = await new VocabularyStore().open();
    const b = await s.backup();
    s.close();
    return b;
  });
  check(
    "complete transactional restoration",
    JSON.stringify(restored.data) === JSON.stringify(backup.data),
  );
  await page.locator("#restore-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"application":"stray-vocabulary","schemaVersion":999}',
    ),
  });
  await page.getByText(/恢复失败/).waitFor();
  check(
    "invalid backup rejected without overwrite",
    await db(async () => {
      const { VocabularyStore } = await import("./modules/storage.mjs");
      const s = await new VocabularyStore().open();
      const n = (await s.all("words")).length;
      s.close();
      return n === 6;
    }),
  );
  await page.reload();
  await page.locator("h1").waitFor();
  check(
    "refresh keeps records",
    await db(async () => {
      const { VocabularyStore } = await import("./modules/storage.mjs");
      const s = await new VocabularyStore().open();
      const n = (await s.all("events")).length;
      s.close();
      return n === 1;
    }),
  );
  await page.locator('#profile-form input[name="profile"]').fill("ui-profile");
  await page.locator("#profile-form button").click();
  await page.waitForFunction(
    () => document.querySelector("#profile-form input")?.value === "ui-profile",
  );
  check("local profile UI creates and selects isolated namespace", true);
  await route("#home");
  check(
    "new local profile has its own empty collection",
    await page.getByText("从你的第一份词库开始").isVisible(),
  );
  await route("#settings");
  await page.locator('#profile-form input[name="profile"]').fill("local");
  await page.locator("#profile-form button").click();
  await page.waitForFunction(
    () => document.querySelector("#profile-form input")?.value === "local",
  );
  check(
    "local profile UI switches back without data loss",
    await db(async () => {
      const { VocabularyStore } = await import("./modules/storage.mjs");
      const s = await new VocabularyStore().open();
      const count = (await s.all("events")).length;
      s.close();
      return count === 1;
    }),
  );
  // Real database integrity tests, run in the actual browser rather than a mock.
  const integrity = await db(async () => {
    const { VocabularyStore, validateBackup } = await import(
      "./modules/storage.mjs"
    );
    const { parseVocabulary } = await import("./modules/parser.mjs");
    const { DEMO_TEXT } = await import("./modules/export-spec.mjs");
    const { newSession } = await import("./modules/session.mjs");
    const { DEFAULTS } = await import("./modules/model.mjs");
    const s = await new VocabularyStore("integrity-test").open(),
      r = parseVocabulary(DEMO_TEXT).records;
    await s.importRecords(r, "default");
    const c = await s.createCollection("shared");
    await s.importRecords(r, c.id);
    const words = await s.all("words"),
      u = (await s.all("units"))[0];
    await s.deleteCollection(c.id);
    const shared =
      (await s.all("words")).length === 6 &&
      (await s.get("words", words[0].wordId)).collectionIds.length === 1;
    const prefs = { ...DEFAULTS },
      session = newSession([u.unitId], prefs);
    await s.put("sessions", session);
    const args = {
      unitId: u.unitId,
      revision: u.revision,
      rating: 4,
      session,
      prefs,
      eventId: "one-event",
    };
    await s.commitGrade(args);
    let duplicate = false;
    try {
      await s.commitGrade(args);
    } catch {
      duplicate = true;
    }
    const before = await s.backup();
    let invalid = false;
    const broken = structuredClone(before);
    broken.data.units[0].wordId = "missing";
    try {
      validateBackup(broken);
    } catch {
      invalid = true;
    }
    // A deliberately colliding identity aborts a whole import chunk without corrupting existing rows.
    const collision = structuredClone(r[0]);
    collision.search = "other";
    const failed = await s.importRecords([collision], "default");
    const after = await s.backup();
    const isolation = await new VocabularyStore("empty-profile").open();
    const isolated = (await isolation.all("words")).length === 0;
    isolation.close();
    const legacy = structuredClone(after);
    legacy.schemaVersion = 1;
    const legacyName = "stray-vocabulary-migration";
    const legacyDb = await new Promise((resolve, reject) => {
      const r = indexedDB.open(legacyName, 1);
      r.onupgradeneeded = () => {
        const keys = {
          collections: "id",
          words: "wordId",
          units: "unitId",
          events: "id",
          assessments: "id",
          sessions: "id",
          meta: "id",
        };
        for (const [name, keyPath] of Object.entries(keys))
          r.result.createObjectStore(name, { keyPath });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = legacyDb.transaction(Object.keys(legacy.data), "readwrite");
      for (const [name, rows] of Object.entries(legacy.data))
        for (const row of rows) tx.objectStore(name).put(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    legacyDb.close();
    const migratedStore = await new VocabularyStore("migration").open();
    const migrated =
      migratedStore.db.version === 2 &&
      JSON.stringify((await migratedStore.backup()).data) ===
        JSON.stringify(legacy.data);
    const dueIndexed = migratedStore.db
      .transaction("units")
      .objectStore("units")
      .indexNames.contains("stateDue");
    await migratedStore.restore(legacy);
    const restoredV1 = (await migratedStore.backup()).schemaVersion === 2;
    migratedStore.close();
    const version = s.db.version;
    s.close();
    return {
      shared,
      duplicate,
      invalid,
      isolated,
      failed: failed.failed === 1,
      intact: JSON.stringify(before.data) === JSON.stringify(after.data),
      oneEvent: after.data.events.length === 1,
      version,
      migrated,
      dueIndexed,
      restoredV1,
    };
  });
  for (const [name, result] of Object.entries(integrity))
    check("IndexedDB " + name, result);
  // XSS must render as text even in definitions, metadata and word details.
  await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const { normalizeRecord } = await import("./modules/model.mjs");
    const s = await new VocabularyStore().open();
    const r = normalizeRecord({
      word: "evil",
      senses: [
        {
          partOfSpeech: "noun",
          definitionEN: '<img src=x onerror="window.__xss=1">',
          definitionZH: "<script>window.__xss=2</script>",
          dictionarySource: "测试",
        },
      ],
    }).record;
    await s.importRecords([r], "default");
    s.close();
  });
  await route("#library");
  await page.locator('input[name="query"]').fill("evil");
  await page.waitForTimeout(300);
  await page.locator('[data-action="detail"]').click();
  await page.locator("#word-detail .panel").waitFor();
  check(
    "untrusted vocabulary escaped",
    await page.evaluate(
      () =>
        !window.__xss &&
        !document.querySelector("#word-detail img") &&
        !document.querySelector("#word-detail script"),
    ),
  );
  await route("#home");
  await page.locator("[data-theme-toggle]").click();
  check(
    "existing theme reused",
    (await page.locator("html").getAttribute("data-theme")) === "dark",
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(artifacts, "desktop-dark.png"),
    fullPage: true,
  });
  for (const [label, width, height] of [
    ["mobile", 390, 844],
    ["ipad-portrait", 768, 1024],
    ["ipad-landscape", 1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await route("#library");
    check(
      label + " no horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, label + ".png"),
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await route("#learn");
  check(
    "reduced motion respects preference",
    await page.evaluate(
      () =>
        !document.querySelector("#flashcard") ||
        getComputedStyle(document.querySelector("#flashcard")).animationName ===
          "none",
    ),
  );
  check(
    "return path retains /stray-articles project base",
    new URL(
      await page
        .locator('header a[href="../../index.html"]')
        .first()
        .getAttribute("href"),
      page.url(),
    ).pathname === "/stray-articles/index.html",
  );
  // Several thousand realistically shaped entries, including polysemy and multiple POS.
  const rich = await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const { parseVocabulary } = await import("./modules/parser.mjs");
    const { DEMO_RECORDS } = await import("./modules/export-spec.mjs");
    const records = Array.from({ length: 2000 }, (_, i) => ({
      ...DEMO_RECORDS[i % DEMO_RECORDS.length],
      word: DEMO_RECORDS[i % DEMO_RECORDS.length].word + "-sample-" + i,
      sourceMetadata: { testing: true },
    }));
    const parsed = parseVocabulary(
      records.map((r) => JSON.stringify(r)).join("\n"),
    );
    const store = await new VocabularyStore("rich-benchmark").open();
    let t = performance.now();
    await store.importRecords(parsed.records, "default");
    const importMs = performance.now() - t;
    const words = await store.all("words"),
      units = await store.all("units");
    const awaitPreferences = await store.preferences();
    t = performance.now();
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./modules/assessment-worker.mjs", location.href),
        { type: "module" },
      );
      worker.onmessage = ({ data }) => {
        worker.terminate();
        data.error ? reject(Error(data.error)) : resolve(data.result);
      };
      worker.onerror = () => reject(Error("assessment worker failure"));
      worker.postMessage({
        words,
        units,
        settings: {
          count: 20,
          exam: "all",
          mode: "all",
          collectionId: "default",
        },
        prefs: awaitPreferences,
      });
    });
    const assessmentMs = performance.now() - t;
    store.close();
    return {
      entries: words.length,
      units: units.length,
      questions: result.questions.length,
      importMs,
      assessmentMs,
    };
  });
  metrics.rich = rich;
  check(
    "2k polysemous entries and background assessment generation",
    rich.entries === 2000 && rich.units > 2000 && rich.questions === 20,
  );
  // Benchmark separate profile; representative structure, synthetic content, no genuine corpus claims.
  metrics.large = await db(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const { buildQueue } = await import("./modules/session.mjs");
    const { DEFAULTS } = await import("./modules/model.mjs");
    const records = Array.from({ length: 10000 }, (_, i) => ({
      word: "benchmark-" + String(i).padStart(5, "0"),
      ipaUS: "/test/",
      examTags: [i % 2 ? "CET-4" : "IELTS"],
      senses: [
        {
          partOfSpeech: "noun",
          definitionEN: "synthetic test concept " + i,
          definitionZH: "测试专用含义 " + i,
          dictionarySource: "合成压力测试数据",
          examples: [
            {
              sentence: "This is synthetic example " + i + ".",
              exampleTranslation: "这是测试专用例句 " + i + "。",
              exampleSource: "合成测试",
              sourceType: "original",
            },
          ],
        },
      ],
    }));
    const text = records.map((r) => JSON.stringify(r)).join("\n"),
      heapBefore = performance.memory?.usedJSHeapSize;
    let t = performance.now();
    const parsed = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./modules/import-worker.mjs", location.href),
        { type: "module" },
      );
      worker.onmessage = ({ data }) => {
        if (data.type === "result") {
          worker.terminate();
          resolve(data.result);
        }
        if (data.type === "error") {
          worker.terminate();
          reject(Error(data.message));
        }
      };
      worker.onerror = () => reject(Error("worker parse failure"));
      worker.postMessage({ text });
    });
    const parseMs = performance.now() - t;
    const storePreview = await new VocabularyStore("benchmark").open();
    t = performance.now();
    await storePreview.previewImport(parsed.records);
    const previewMs = performance.now() - t;
    storePreview.close();
    const store = await new VocabularyStore("benchmark").open();
    t = performance.now();
    const imported = await store.importRecords(parsed.records, "default");
    const importMs = performance.now() - t;
    t = performance.now();
    const found = await store.search({
      query: "benchmark-09",
      collectionId: "default",
    });
    const searchMs = performance.now() - t;
    t = performance.now();
    const filtered = await store.search({
      exam: "CET-4",
      collectionId: "default",
    });
    const filterMs = performance.now() - t;
    t = performance.now();
    const units = await store.all("units", "collection", "default");
    const queue = buildQueue({ units, events: [], prefs: { ...DEFAULTS } });
    const queueMs = performance.now() - t;
    t = performance.now();
    const b = await store.backup();
    const backupMs = performance.now() - t;
    t = performance.now();
    await store.restore(b);
    const restoreMs = performance.now() - t;
    const restoredCount = (await store.all("words")).length,
      heapAfter = performance.memory?.usedJSHeapSize;
    store.close();
    return {
      entries: 10000,
      units: units.length,
      inputBytes: new Blob([text]).size,
      parseMs,
      previewMs,
      importMs,
      searchMs,
      filterMs,
      queueMs,
      backupMs,
      restoreMs,
      restoredCount,
      newQueueSize: queue.length,
      imported: imported.imported,
      searchCount: found.total,
      filterCount: filtered.total,
      heapBefore,
      heapAfter,
    };
  });
  check(
    "10k import, queue, search, filtering and restore complete",
    metrics.large.imported === 10000 &&
      metrics.large.restoredCount === 10000 &&
      metrics.large.filterCount === 5000 &&
      metrics.large.searchCount === 1000 &&
      metrics.large.newQueueSize === 20,
  );
  for (const [metric, budget] of Object.entries({
    parseMs: 1500,
    previewMs: 500,
    importMs: 30000,
    searchMs: 500,
    filterMs: 500,
    queueMs: 1000,
    restoreMs: 45000,
  }))
    check("performance budget " + metric, metrics.large[metric] < budget);
  // Render benchmarks measure application-ready state in the same browser/profile.
  await page.evaluate(() =>
    localStorage.setItem("stray-vocabulary-profile", "benchmark"),
  );
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let t = Date.now();
  await route("#home");
  metrics.homepage10kMs = Date.now() - t;
  t = Date.now();
  await route("#learn");
  await page.locator("#flashcard").waitFor();
  metrics.learning10kMs = Date.now() - t;
  fs.writeFileSync(
    path.join(artifacts, "partial-measurements.json"),
    JSON.stringify(metrics, null, 2),
  );
  const planned = await page.evaluate(async () => {
    const { VocabularyStore } = await import("./modules/storage.mjs");
    const s = await new VocabularyStore("benchmark").open();
    const session = await s.get("sessions", "learning");
    s.close();
    return session.queue.length - session.index;
  });
  check("twenty new words queued", planned === 20);
  check("homepage 10k budget <2s", metrics.homepage10kMs < 2000);
  check("learning 10k budget <2.5s", metrics.learning10kMs < 2500);
  const transitionTimes = [];
  const heapStart = await page.evaluate(
    () => performance.memory?.usedJSHeapSize,
  );
  for (let i = 0; i < 20; i++) {
    console.log("card " + (i + 1));
    await page.locator('[data-action="reveal"]').click();
    t = Date.now();
    await page.locator('[data-rating="4"]').click();
    if (i < 19)
      await page.waitForFunction(() => {
        const b = document.querySelector('[data-action="reveal"]');
        return b && !b.disabled;
      });
    else await page.getByText("本轮学习已完成", { exact: true }).waitFor();
    transitionTimes.push(Date.now() - t);
  }
  metrics.twentyCardSession = {
    minMs: Math.min(...transitionTimes),
    maxMs: Math.max(...transitionTimes),
    meanMs: transitionTimes.reduce((s, x) => s + x, 0) / transitionTimes.length,
    heapStart,
    heapEnd: await page.evaluate(() => performance.memory?.usedJSHeapSize),
  };
  if ((await page.locator("html").getAttribute("data-theme")) === "dark")
    await page.locator("[data-theme-toggle]").click();
  await page.goto(base + "#home");
  await page.locator(".intro h1").waitFor();
  await page.screenshot({
    path: path.join(artifacts, "desktop-light.png"),
    fullPage: true,
  });
  check(
    "light theme actually rendered",
    (await page.locator("html").getAttribute("data-theme")) === "light",
  );
  // Close the browser process, then reopen the same actual disk profile.
  await context.close();
  const second = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  });
  const restarted = second.browser();
  const p2 = await second.newPage();
  await p2.goto(base + "#home");
  await p2.locator(".intro h1").waitFor();
  check(
    "normal browser restart preserves actual IndexedDB on disk",
    await p2.evaluate(async () => {
      const { VocabularyStore } = await import("./modules/storage.mjs");
      const s = await new VocabularyStore("benchmark").open();
      const count = (await s.all("events")).length;
      s.close();
      return count === 20;
    }),
  );

  metrics.environment = {
    node: process.version,
    browser: await restarted.version(),
    platform: os.platform(),
    cpus: os.cpus().length,
    cpu: os.cpus()[0]?.model,
    totalMemoryBytes: os.totalmem(),
    viewport: "1365x900",
    context:
      "headless Chromium, loopback HTTP, synthetic dataset, single run; heap is browser estimate",
  };
  check("no browser runtime errors", errors.length === 0);
  await second.close();
  fs.rmSync(profilePath, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(artifacts, "measurements.json"),
    JSON.stringify({ checks, metrics, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, metrics }, null, 2));
})()
  .catch(async (e) => {
    console.error(e);
    if (debugPage && !debugPage.isClosed()) {
      await debugPage.screenshot({
        path: path.join(artifacts, "failure.png"),
        fullPage: true,
      });
      fs.writeFileSync(
        path.join(artifacts, "failure.html"),
        await debugPage.content(),
      );
      console.error(await debugPage.locator("#notice").textContent());
    }
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1000);
  })
  .finally(() => {
    server.close();
  });
