const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const puppeteer = require("puppeteer-core");

const root = path.resolve(__dirname, "..");

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const filePath = path.normalize(path.join(root, pathname));
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
      };
      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end("error");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function installWatchers(page) {
  await page.evaluateOnNewDocument(() => {
    window.__storageWrites = [];
    const record = (kind) => window.__storageWrites.push(kind);
    for (const method of ["setItem", "removeItem", "clear"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        record("storage." + method);
        return original.apply(this, args);
      };
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
      if (descriptor && descriptor.set) {
        Object.defineProperty(Document.prototype, "cookie", {
          configurable: true,
          get() {
            return descriptor.get.call(this);
          },
          set(value) {
            record("cookie");
            return descriptor.set.call(this, value);
          },
        });
      }
    } catch (error) {
      /* The page does not use cookies; a failed watch must not look like a write. */
    }
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      record("indexedDB.open");
      return originalOpen.apply(this, args);
    };
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      const originalRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function (...args) {
        record("serviceWorker.register");
        return originalRegister(...args);
      };
    }
  });
}

async function assertPassage(page, line, stacked) {
  const info = await page.evaluate((lineNo) => {
    const passage = document.getElementById("passage");
    const questions = document.getElementById("questions");
    const passageRect = passage.getBoundingClientRect();
    const questionRect = questions.getBoundingClientRect();
    const row = passage.querySelector(`[data-line="${lineNo}"]`);
    const rowRect = row.getBoundingClientRect();
    const visibleHeight =
      Math.min(rowRect.bottom, passageRect.bottom) - Math.max(rowRect.top, passageRect.top);
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      display: getComputedStyle(passage).display,
      p: {
        top: passageRect.top,
        left: passageRect.left,
        right: passageRect.right,
        bottom: passageRect.bottom,
        width: passageRect.width,
        height: passageRect.height,
      },
      q: {
        top: questionRect.top,
        left: questionRect.left,
        right: questionRect.right,
        bottom: questionRect.bottom,
        width: questionRect.width,
        height: questionRect.height,
      },
      lineInPane: visibleHeight > 8 && rowRect.right > 0 && rowRect.left < window.innerWidth,
      lineNo: row.querySelector(".ln").textContent.trim(),
      lineText: row.innerText,
    };
  }, line);
  assert.notEqual(info.display, "none");
  assert.ok(info.p.height > 80, "passage should stay on screen");
  assert.ok(info.q.height > 80, "questions should stay on screen");
  assert.ok(info.p.top >= -1 && info.p.bottom <= info.vh + 2, "passage pane inside the viewport");
  assert.ok(info.q.top >= -1 && info.q.bottom <= info.vh + 2, "question pane inside the viewport");
  assert.equal(info.lineNo, String(line));
  assert.ok(info.lineInPane, "line " + line + " should be visible in the passage");
  if (stacked) {
    assert.ok(info.q.top >= info.p.bottom - 6, "narrow layout stacks the passage above the questions");
    assert.ok(info.p.width > info.vw * 0.7, "stacked passage uses the screen width");
  } else {
    assert.ok(info.p.right <= info.q.left + 2, "wide layout places the passage beside the questions");
    const overlap = Math.min(info.p.bottom, info.q.bottom) - Math.max(info.p.top, info.q.top);
    assert.ok(overlap > 80, "side-by-side panes share the vertical space");
  }
  return info;
}

async function assertNoTeacherLeak(page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const phrase of [
    "was not supplied",
    "source Question 6",
    "not a reconstruction",
    "範例／教師用",
    "original_item_reason",
    "teacher_review",
    "CEFR",
    "mastery",
    "trophy",
    "Excellent",
  ]) {
    assert.equal(text.includes(phrase), false, phrase);
  }
  assert.equal(await page.$$eval("img, svg", (els) => els.length), 0);
}

async function clickNext(page, expected) {
  await page.click("#questions button[data-action='next']");
  await page.waitForFunction((exp) => {
    const el = document.getElementById("questions");
    if (exp === "review") return el.dataset.kind === "review";
    return (el.dataset.screen || "").split(/\s+/).includes(exp);
  }, {}, expected);
}

async function submit(page) {
  await page.click("#questions button[data-action='submit']");
}

async function waitOutcome(page, id, outcome) {
  await page.waitForFunction(
    (itemId, value) => {
      const el = document.querySelector(`[data-item-id="${itemId}"]`);
      return Boolean(el && el.dataset.outcome === value);
    },
    {},
    id,
    outcome
  );
}

async function setHeadings(page, values) {
  for (const [slot, heading] of Object.entries(values)) {
    await page.select(`select[data-slot="${slot}"]`, heading);
  }
  const got = await page.evaluate(() => ({
    A: document.querySelector('[data-slot="A"]').value,
    B: document.querySelector('[data-slot="B"]').value,
    C: document.querySelector('[data-slot="C"]').value,
    D: document.querySelector('[data-slot="D"]').value,
    E: document.querySelector('[data-slot="E"]').value,
  }));
  assert.deepEqual(got, values);
}

test("headless Chrome practises both stations and then closes", { timeout: 180000 }, async () => {
  let browser;
  let server;
  const requests = [];
  try {
    server = await startServer();
    const { port } = server.address();
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    page.on("request", (request) => {
      requests.push(request.method() + " " + request.url());
    });
    page.on("pageerror", (error) => {
      console.error("PAGEERROR", error);
    });
    await installWatchers(page);
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#passage [data-line='3']");

    const set1Lines = await page.$$eval("#passage [data-line]", (els) =>
      els.map((el) => Number(el.dataset.line))
    );
    assert.deepEqual(set1Lines, Array.from({ length: 30 }, (_, index) => index + 1));
    await assertPassage(page, 3, false);
    const intro = await page.$eval("[data-locked='introduction']", (el) => el.innerText);
    assert.match(intro, /Introduction/);
    assert.equal(await page.$$eval("[data-locked='introduction'] select", (els) => els.length), 0);
    const bank = await page.$eval("#heading-bank", (el) => el.innerText);
    assert.match(bank, /Skills & Qualities/);
    assert.match(bank, /Introduction/);
    const optionValues = await page.$$eval("select[data-slot='A'] option", (els) =>
      els.map((el) => el.value)
    );
    assert.equal(optionValues.includes("Introduction"), false);
    assert.equal(optionValues.includes("Skills & Qualities"), true);

    await page.evaluate(() => {
      const chip = document.querySelector('[data-heading="More information"]');
      const box = document.querySelector('[data-drop-slot="A"]');
      const transfer = new DataTransfer();
      chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      box.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    assert.equal(await page.$eval("select[data-slot='A']", (el) => el.value), "More information");

    await setHeadings(page, {
      A: "More information",
      B: "Job descriptions",
      C: "Skills & Qualities",
      D: "Income & working hours",
      E: "Entry requirements",
    });
    await submit(page);
    const firstHint = await page.$eval("[data-feedback-for='S1-H01']", (el) => el.textContent);
    assert.match(firstHint, /第 5 行/);
    assert.doesNotMatch(firstHint, /第 11 行/);
    assert.doesNotMatch(firstHint, /Box A \(line 5\)/);
    assert.doesNotMatch(firstHint, /Income & working hours/);
    assert.equal(
      await page.$eval("[data-item-id='S1-H01']", (el) => el.dataset.outcome || ""),
      ""
    );

    await setHeadings(page, {
      A: "Job descriptions",
      B: "Skills & Qualities",
      C: "Income & working hours",
      D: "Entry requirements",
      E: "More information",
    });
    await submit(page);
    await waitOutcome(page, "S1-H01", "hinted_success");
    assert.equal(
      await page.$$eval("[data-item-id='S1-H01'][data-outcome='first_correct']", (els) => els.length),
      0
    );
    await assertPassage(page, 3, false);

    await clickNext(page, "S1-Q01");
    assert.equal(await page.$("#heading-bank"), null);
    await page.click("input[name='S1-Q01'][value='A']");
    await submit(page);
    await waitOutcome(page, "S1-Q01", "first_correct");
    const q01Feedback = await page.$eval("[data-feedback-for='S1-Q01']", (el) => el.textContent);
    assert.match(q01Feedback, /suitable/);
    assert.doesNotMatch(q01Feedback, /看第 3 行/);

    await clickNext(page, "S1-Q02");
    await page.click("input[name='S1-Q02'][value='A']");
    await submit(page);
    const q02Hint = await page.$eval("[data-feedback-for='S1-Q02']", (el) => el.textContent);
    assert.match(q02Hint, /each week/);
    assert.doesNotMatch(q02Hint, /The answer is B/);
    await page.click("input[name='S1-Q02'][value='C']");
    await submit(page);
    await waitOutcome(page, "S1-Q02", "incorrect");
    const q02Explain = await page.$eval("[data-feedback-for='S1-Q02']", (el) => el.textContent);
    assert.match(q02Explain, /The answer is B, 48 hours/);

    await clickNext(page, "S1-Q03");
    await page.click("input[name='S1-Q03'][value='D']");
    await submit(page);
    await waitOutcome(page, "S1-Q03", "first_correct");

    await clickNext(page, "S1-Q04");
    await page.click("input[name='S1-Q04'][value='C']");
    await submit(page);
    await waitOutcome(page, "S1-Q04", "first_correct");

    await clickNext(page, "S1-Q05");
    const multiCopy = await page.$eval("#questions", (el) => el.innerText);
    assert.match(multiCopy, /You can choose more than one answer/);
    assert.match(multiCopy, /你可以選擇多於一個答案。/);
    await page.click("input[name='S1-Q05'][value='C']");
    await submit(page);
    const multiHint = await page.$eval("[data-feedback-for='S1-Q05']", (el) => el.textContent);
    assert.match(multiHint, /只選擇網頁真正支持的陳述/);
    assert.doesNotMatch(multiHint, /The correct set is B and C/);
    assert.equal(await page.$eval("[data-item-id='S1-Q05']", (el) => el.dataset.outcome || ""), "");
    await page.click("input[name='S1-Q05'][value='B']");
    await submit(page);
    await waitOutcome(page, "S1-Q05", "hinted_success");

    await clickNext(page, "S1-Q06a");
    const note = await page.$eval("#questions .note", (el) => el.innerText);
    assert.match(note, /leisure centre lifeguard/);
    assert.match(note, /safety rule/);
    assert.match(note, /much money/);
    assert.equal(await page.$$eval("input[data-gap]", (els) => els.length), 3);
    await page.type("input[data-gap='S1-Q06a']", "swimming pool");
    await page.type("input[data-gap='S1-Q06b']", "whistle");
    await page.type("input[data-gap='S1-Q06c']", "Earn");
    await submit(page);
    await waitOutcome(page, "S1-Q06b", "first_correct");
    await waitOutcome(page, "S1-Q06c", "first_correct");
    const gapHint = await page.$eval("[data-feedback-for='S1-Q06a']", (el) => el.textContent);
    assert.match(gapHint, /第 \(1\) 格/);
    assert.equal(await page.$eval("[data-item-id='S1-Q06a']", (el) => el.dataset.outcome || ""), "");
    await page.$eval("input[data-gap='S1-Q06a']", (el) => {
      el.value = "pool";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(page);
    await waitOutcome(page, "S1-Q06a", "hinted_success");
    assert.equal(
      await page.$$eval("[data-item-id='S1-Q06a'][data-outcome='first_correct']", (els) => els.length),
      0
    );

    await clickNext(page, "review");
    const set1Score = await page.$eval("#score", (el) => ({
      earned: el.dataset.earned,
      total: el.dataset.total,
      count: el.dataset.scoredCount,
    }));
    assert.deepEqual(set1Score, { earned: "8", total: "9", count: "9" });
    const set1Review = await page.$$eval("#review-list [data-review-id]", (els) =>
      els.map((el) => el.dataset.reviewId)
    );
    assert.deepEqual(set1Review, [
      "S1-H01",
      "S1-Q01",
      "S1-Q02",
      "S1-Q03",
      "S1-Q04",
      "S1-Q05",
      "S1-Q06a",
      "S1-Q06b",
      "S1-Q06c",
    ]);
    await assertNoTeacherLeak(page);

    await page.click("#continue-set2");
    await page.waitForFunction(() => document.getElementById("workspace").dataset.station === "set2");
    await page.waitForSelector("#passage [data-line='17']");
    const set2Lines = await page.$$eval("#passage [data-line]", (els) =>
      els.map((el) => Number(el.dataset.line))
    );
    assert.deepEqual(set2Lines, Array.from({ length: 35 }, (_, index) => index + 1));
    const passageText = await page.$eval("#passage", (el) => el.innerText);
    assert.match(passageText, /Harbour Lights Job Fair/);
    assert.match(passageText, /Melody Studio/);
    assert.doesNotMatch(passageText, /Leisure centre lifeguards/);
    const music = await page.$eval("[data-ad='music']", (el) => el.innerText);
    assert.match(music, /Melody Studio/);
    await assertPassage(page, 1, false);
    assert.equal(await page.$("#heading-bank"), null);
    assert.equal(await page.$("#glossary"), null);
    assert.equal(await page.$("#profile"), null);

    await page.click("input[name='S2-Q01'][value='D']");
    await submit(page);
    await waitOutcome(page, "S2-Q01", "first_correct");

    await clickNext(page, "S2-Q02");
    const statements = await page.$$eval("#questions .statements li", (els) =>
      els.map((el) => el.textContent.trim())
    );
    assert.equal(statements.length, 4);
    assert.match(statements[0], /young children/);
    assert.match(statements[1], /imaginative/);
    assert.match(statements[2], /good at English/);
    assert.match(statements[3], /story ready/);
    await page.click("input[name='S2-Q02'][value='D']");
    await submit(page);
    await waitOutcome(page, "S2-Q02", "first_correct");

    await clickNext(page, "S2-Q03");
    const gloss = await page.$eval("#glossary", (el) => el.innerText);
    assert.match(gloss, /railway engine/);
    assert.match(gloss, /long line of people/);
    assert.match(gloss, /teach a person or animal/);
    assert.match(gloss, /practising/);
    assert.match(gloss, /Sha Tin/);
    assert.match(gloss, /\bn\b/);
    assert.match(gloss, /\bv\b/);
    const trainLine = await assertPassage(page, 17, false);
    assert.match(trainLine.lineText, /We will train you in the first two weeks\./);
    await page.click("input[name='S2-Q03'][value='C']");
    await submit(page);
    await waitOutcome(page, "S2-Q03", "first_correct");

    await clickNext(page, "S2-Q04");
    const profile = await page.$eval("#profile", (el) => el.innerText);
    assert.match(profile, /Chris/);
    assert.match(profile, /I love being outdoors/);
    assert.match(profile, /showing new routes/);
    assert.equal(await page.$$eval("#profile img, #questions img, #passage img", (els) => els.length), 0);
    const optionC = await page.$eval("input[name='S2-Q04'][value='C']", (el) => el.parentElement.innerText);
    assert.match(optionC, /Melody Studio/);
    assert.equal(await page.$("#glossary"), null);
    await page.click("input[name='S2-Q04'][value='B']");
    await submit(page);
    await waitOutcome(page, "S2-Q04", "first_correct");

    await clickNext(page, "S2-Q05");
    await page.click("input[name='S2-Q05'][value='D']");
    await submit(page);
    await waitOutcome(page, "S2-Q05", "first_correct");

    await clickNext(page, "S2-Q06a");
    const message = await page.$eval("#questions .note", (el) => el.innerText);
    assert.match(message, /Weekend Cycling/);
    assert.match(message, /Saturdays and/);
    assert.match(message, /address below/);
    assert.match(message, /Ryan/);
    assert.equal(await page.$$eval("input[data-gap]", (els) => els.length), 4);
    await page.type("input[data-gap='S2-Q06a']", "Guide");
    await page.type("input[data-gap='S2-Q06b']", "outdoors");
    await page.type("input[data-gap='S2-Q06c']", "Sunday");
    await page.type("input[data-gap='S2-Q06d']", "e-mail");
    await submit(page);
    await waitOutcome(page, "S2-Q06a", "first_correct");
    await waitOutcome(page, "S2-Q06b", "first_correct");
    await waitOutcome(page, "S2-Q06d", "first_correct");
    const sundayHint = await page.$eval("[data-feedback-for='S2-Q06c']", (el) => el.textContent);
    assert.match(sundayHint, /單複數/);
    assert.doesNotMatch(sundayHint, /The word is Sundays/);
    await page.$eval("input[data-gap='S2-Q06c']", (el) => {
      el.value = "Sundays";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(page);
    await waitOutcome(page, "S2-Q06c", "hinted_success");
    assert.equal(await page.$("[data-item-id='S2-Q06']"), null);

    await clickNext(page, "review");
    const reviewIds = await page.$$eval("#review-list [data-review-id]", (els) =>
      els.map((el) => el.dataset.reviewId)
    );
    assert.deepEqual(reviewIds, [
      "S2-Q01",
      "S2-Q02",
      "S2-Q03",
      "S2-Q04",
      "S2-Q05",
      "S2-Q06a",
      "S2-Q06b",
      "S2-Q06c",
      "S2-Q06d",
    ]);
    assert.equal(reviewIds.includes("S2-Q06"), false);
    const set2Score = await page.$eval("#score", (el) => ({
      earned: el.dataset.earned,
      total: el.dataset.total,
      count: el.dataset.scoredCount,
    }));
    assert.deepEqual(set2Score, { earned: "9", total: "9", count: "9" });
    await assertNoTeacherLeak(page);

    const writesBeforeReload = await page.evaluate(() => window.__storageWrites.slice());
    await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 414);
    await assertPassage(page, 1, true);

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("#passage [data-line='3']");
    const cleared = await page.$eval("#score", (el) => ({
      earned: el.dataset.earned,
      station: el.dataset.station,
    }));
    assert.deepEqual(cleared, { earned: "0", station: "set1" });
    assert.equal(await page.$$eval("[data-outcome]", (els) => els.length), 0);
    await assertPassage(page, 3, true);
    assert.equal(await page.$eval("#workspace", (el) => el.dataset.station), "set1");

    await page.click("button[data-action='next']");
    await page.waitForFunction(() =>
      (document.getElementById("questions").dataset.screen || "").includes("S1-Q01")
    );
    await page.click("input[name='S1-Q01'][value='A']");
    await submit(page);
    await waitOutcome(page, "S1-Q01", "first_correct");
    assert.equal(await page.$eval("#score", (el) => el.dataset.earned), "1");
    await page.click("#reset-btn");
    await page.waitForFunction(() => document.getElementById("score").dataset.earned === "0");
    assert.equal(await page.$eval("#workspace", (el) => el.dataset.station), "set1");
    assert.equal(await page.$eval("#questions", (el) => el.dataset.screen), "S1-H01");
    assert.equal(await page.$eval("select[data-slot='A']", (el) => el.value), "");
    assert.match(await page.$eval("#notice", (el) => el.textContent), /分數已清除/);
    assert.equal(await page.$$eval("[data-outcome]", (els) => els.length), 0);

    const writesAfterReload = await page.evaluate(() => window.__storageWrites.slice());
    assert.deepEqual(writesBeforeReload.concat(writesAfterReload), []);
    const writesAfter = requests.filter((entry) => !entry.startsWith("GET ") && !entry.startsWith("HEAD "));
    assert.deepEqual(writesAfter, []);
    assert.ok(requests.some((entry) => entry.includes("/data/exercises.json")));
    assert.ok(requests.every((entry) => entry.includes("127.0.0.1")));
  } finally {
    if (browser) await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
