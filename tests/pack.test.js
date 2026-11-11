const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const Marking = require(path.join(root, "js/marking.js"));
const Passages = require(path.join(root, "js/passages.js"));

const EXPECTED_HASH = "ccbf7e72e2fbaee61ed463da2e2c223268a1669472544747689b28eedf9d9473";
const SET1_IDS = [
  "S1-H01",
  "S1-Q01",
  "S1-Q02",
  "S1-Q03",
  "S1-Q04",
  "S1-Q05",
  "S1-Q06a",
  "S1-Q06b",
  "S1-Q06c",
];
const SET2_IDS = [
  "S2-Q01",
  "S2-Q02",
  "S2-Q03",
  "S2-Q04",
  "S2-Q05",
  "S2-Q06a",
  "S2-Q06b",
  "S2-Q06c",
  "S2-Q06d",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath));
}

function loadPack() {
  return JSON.parse(read("data/exercises.json").toString("utf8"));
}

function itemById(pack, id) {
  for (const station of pack.stations) {
    const found = station.items.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

function numberedLines(block) {
  const map = new Map();
  for (const raw of block.split("\n")) {
    const match = raw.match(/^\s*(\d+)\s+(.*)$/);
    if (match) map.set(Number(match[1]), match[2].trim());
  }
  return map;
}

test("exercises.json matches the authoritative pack hash", () => {
  const bytes = read("data/exercises.json");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash, EXPECTED_HASH);
});

test("the pack scores exactly the 18 required items", () => {
  const pack = loadPack();
  assert.deepEqual(pack.meta.set1_scored_item_ids, SET1_IDS);
  assert.deepEqual(pack.meta.set2_scored_item_ids, SET2_IDS);
  assert.equal(pack.meta.total_scored_items, 18);
  const scored = Marking.scoredItems(pack);
  assert.deepEqual(
    scored.map((item) => item.id),
    SET1_IDS.concat(SET2_IDS)
  );
  assert.equal(scored.length, 18);
  assert.ok(scored.every((item) => item.teacher_review !== true));
  const set1 = Marking.scoreStation(pack.stations[0].items, {});
  const set2 = Marking.scoreStation(pack.stations[1].items, {});
  assert.equal(set1.total, 9);
  assert.equal(set2.total, 9);
  assert.equal(set1.count, 9);
  assert.equal(set2.count, 9);
  assert.equal(itemById(pack, "S1-H01").marks, 1);
  assert.equal(itemById(pack, "S1-H01").scoring, "all_or_nothing");
});

test("S2-Q06 is an unscored display group and is not a tenth item", () => {
  const pack = loadPack();
  const group = itemById(pack, "S2-Q06");
  assert.equal(group.scored, false);
  assert.equal(group.marks, 0);
  assert.equal(group.role, "display_group");
  assert.equal(group.type, "gap_note_group");
  assert.equal(group.teacher_review, false);
  assert.equal(Marking.isScoredItem(group), false);
  const set2 = pack.stations[1];
  const withGroup = Marking.scoreStation(set2.items.concat([group]), {});
  assert.deepEqual(withGroup.ids, SET2_IDS);
  assert.equal(withGroup.total, 9);
  const screens = Marking.buildScreens(set2);
  const ids = screens.flatMap((screen) => screen.ids);
  assert.equal(ids.includes("S2-Q06"), false);
  const gaps = screens.find((screen) => screen.kind === "gaps");
  assert.deepEqual(gaps.ids, ["S2-Q06a", "S2-Q06b", "S2-Q06c", "S2-Q06d"]);
  assert.equal(gaps.noteId, "S2-Q06");
  const review = screens[screens.length - 1];
  assert.equal(review.kind, "review");
  assert.deepEqual(review.ids, SET2_IDS);
  const set1Screens = Marking.buildScreens(pack.stations[0]);
  assert.deepEqual(set1Screens[set1Screens.length - 1].ids, SET1_IDS);
  assert.deepEqual(
    set1Screens.find((screen) => screen.kind === "gaps").ids,
    ["S1-Q06a", "S1-Q06b", "S1-Q06c"]
  );
});

test("heading match is all or nothing and names only the first wrong box", () => {
  const item = itemById(loadPack(), "S1-H01");
  const correct = {
    A: "Job descriptions",
    B: "Skills & Qualities",
    C: "Income & working hours",
    D: "Entry requirements",
    E: "More information",
  };
  assert.equal(Marking.markItem(item, correct).correct, true);
  assert.equal(Marking.markItem(item, { ...correct, A: " Job descriptions " }).correct, true);

  const informal = { ...correct, B: "Skills + Qualities" };
  const informalResult = Marking.markItem(item, informal);
  assert.equal(informalResult.correct, false);
  assert.equal(informalResult.firstWrongSlot, "B");
  assert.equal(Marking.markItem(item, { ...correct, B: "skills & qualities" }).correct, false);
  assert.equal(Marking.markItem(item, { ...correct, B: "Skills and Qualities" }).correct, false);

  const firstEmpty = Marking.markItem(item, { A: "", B: "", C: "", D: "", E: "" });
  assert.equal(firstEmpty.firstWrongSlot, "A");
  const later = Marking.markItem(item, { ...correct, B: "Job descriptions", C: "More information" });
  assert.equal(later.correct, false);
  assert.equal(later.firstWrongSlot, "B");
  const hint = Marking.hintText(item, { firstWrongSlot: "B" });
  assert.equal(hint, item.hint_by_first_wrong_slot.B);
  assert.equal(hint.includes(item.hint_by_first_wrong_slot.C), false);
  assert.equal(hint.includes("Income & working hours"), false);
  assert.equal(Marking.feedbackMode({ attempts: 1, outcome: null, hintShown: true }), "hint");
});

test("multi-select scores only the exact set", () => {
  const item = itemById(loadPack(), "S1-Q05");
  assert.deepEqual(item.accepted, ["B", "C"]);
  assert.equal(item.direction_en, "You can choose more than one answer.");
  assert.equal(item.direction_zh.includes("你可以選擇多於一個答案。"), true);
  assert.equal(Marking.markItem(item, ["B", "C"]).correct, true);
  assert.equal(Marking.markItem(item, ["C", "B"]).correct, true);
  assert.equal(Marking.markItem(item, ["C"]).correct, false);
  assert.equal(Marking.markItem(item, ["B"]).correct, false);
  assert.equal(Marking.markItem(item, ["B", "C", "D"]).correct, false);
  assert.equal(Marking.markItem(item, []).correct, false);
});

test("single-answer items use the JSON keys", () => {
  const pack = loadPack();
  assert.equal(Marking.markItem(itemById(pack, "S2-Q02"), "D").correct, true);
  assert.equal(Marking.markItem(itemById(pack, "S2-Q02"), "A").correct, false);
  assert.equal(itemById(pack, "S2-Q02").type, "mcq_combination");
  assert.equal(itemById(pack, "S2-Q02").statements.length, 4);
  assert.equal(Marking.markItem(itemById(pack, "S2-Q03"), "C").correct, true);
  assert.equal(Marking.markItem(itemById(pack, "S1-Q01"), "A").correct, true);
  assert.equal(Marking.markItem(itemById(pack, "S1-Q01"), "a").correct, false);
});

test("one-word gaps trim, ignore case, and keep the tight forms", () => {
  const pack = loadPack();
  const pool = itemById(pack, "S1-Q06a");
  const whistle = itemById(pack, "S1-Q06b");
  const earn = itemById(pack, "S1-Q06c");
  const guide = itemById(pack, "S2-Q06a");
  const outdoors = itemById(pack, "S2-Q06b");
  const sundays = itemById(pack, "S2-Q06c");
  const email = itemById(pack, "S2-Q06d");

  assert.deepEqual(pool.accepted, ["pool"]);
  assert.equal(Marking.markItem(pool, "pool").correct, true);
  assert.equal(Marking.markItem(pool, " Pool ").correct, true);
  assert.equal(Marking.markItem(pool, "POOL").correct, true);
  assert.equal(Marking.markItem(pool, "swimming pool").correct, false);
  assert.equal(Marking.markItem(pool, "swimming  pool").correct, false);
  assert.equal(Marking.markItem(pool, "pools").correct, false);
  assert.equal(Marking.markItem(pool, "").correct, false);

  assert.equal(Marking.markItem(whistle, "Whistle").correct, true);
  assert.equal(Marking.markItem(earn, "EARN").correct, true);
  assert.equal(Marking.markItem(guide, "guide").correct, true);
  assert.equal(Marking.markItem(guide, "GUIDE").correct, true);
  assert.equal(Marking.markItem(outdoors, "outdoors").correct, true);
  assert.equal(Marking.markItem(outdoors, "outside").correct, false);

  assert.deepEqual(sundays.accepted, ["Sundays"]);
  assert.equal(Marking.markItem(sundays, "Sundays").correct, true);
  assert.equal(Marking.markItem(sundays, " sundays ").correct, true);
  assert.equal(Marking.markItem(sundays, "Sunday").correct, false);
  assert.equal(Marking.markItem(sundays, "sunday").correct, false);
  assert.equal(Marking.markItem(sundays, "Sundays.").correct, false);

  for (const form of ["e-mail", "email", "E-mail", "Email", "E-MAIL", " EMAIL "]) {
    assert.equal(Marking.markItem(email, form).correct, true, form);
  }
  assert.equal(Marking.markItem(email, "e mail").correct, false);
  assert.equal(Marking.markItem(email, "write").correct, false);
  assert.equal(Marking.markItem(email, "call").correct, false);

  const set1Note = Marking.splitNote(pool.note_full);
  const set2Note = Marking.splitNote(itemById(pack, "S2-Q06").note_full);
  assert.deepEqual(
    set1Note.filter((part) => part.type === "blank").map((part) => part.n),
    [1, 2, 3]
  );
  assert.deepEqual(
    set2Note.filter((part) => part.type === "blank").map((part) => part.n),
    [1, 2, 3, 4]
  );
  assert.equal(set1Note.map((part) => part.text || "").join("").includes("much money"), true);
  assert.equal(set2Note.map((part) => part.text || "").join("").includes("Weekend Cycling"), true);
  assert.equal(set2Note.map((part) => part.text || "").join("").includes("address below"), true);
});

test("attempt rule records first_correct, hinted_success, then incorrect", () => {
  let attempt = Marking.applySubmission(null, true);
  assert.equal(attempt.outcome, "first_correct");
  assert.equal(attempt.hintShown, false);
  assert.equal(Marking.feedbackMode(attempt), "first_correct");

  attempt = Marking.applySubmission(null, false);
  assert.equal(attempt.outcome, null);
  assert.equal(attempt.hintShown, true);
  assert.equal(attempt.attempts, 1);
  assert.equal(Marking.feedbackMode(attempt), "hint");
  attempt = Marking.applySubmission(attempt, true);
  assert.equal(attempt.outcome, "hinted_success");
  assert.notEqual(attempt.outcome, "first_correct");
  assert.equal(Marking.feedbackMode(attempt), "hinted_success");

  attempt = Marking.applySubmission(null, false);
  attempt = Marking.applySubmission(attempt, false);
  assert.equal(attempt.outcome, "incorrect");
  assert.equal(Marking.feedbackMode(attempt), "incorrect_after_retry");
  const frozen = Marking.applySubmission(attempt, true);
  assert.equal(frozen.outcome, "incorrect");

  const openedEarly = Marking.applySubmission(
    { attempts: 0, outcome: null, hintShown: true },
    true
  );
  assert.equal(openedEarly.outcome, "hinted_success");
});

test("passages keep pupil lines, Melody Studio, the train sentence, and the profile", () => {
  const markdown = read("data/passages.md").toString("utf8");
  const parsed = Passages.parsePassages(markdown);
  const fences = markdown.match(/```[^\n]*\n([\s\S]*?)```/g).map((fence) => fence.replace(/^```[^\n]*\n|```$/g, ""));
  const set1 = numberedLines(fences[0]);
  const set2 = numberedLines(fences[1]);
  const textLines = parsed.set1.lines.filter((line) => line.kind === "text");
  for (const line of textLines) {
    assert.equal(set1.get(line.line), line.text);
  }
  assert.deepEqual(
    parsed.set1.lines.filter((line) => line.kind === "slot").map((line) => line.slot),
    ["A", "B", "C", "D", "E"]
  );
  assert.equal(parsed.set1.lines.some((line) => line.kind === "blank" && line.line === 4), true);
  assert.equal(parsed.set1.lines.some((line) => line.kind === "introduction"), true);
  assert.equal(parsed.set2.lines.length, 35);
  for (const line of parsed.set2.lines) {
    assert.equal(set2.get(line.line), line.text);
  }
  assert.equal(parsed.set1.title, "Jobs in the Community: Leisure Centre Lifeguard");
  assert.match(parsed.set2.lines.find((line) => line.line === 19).text, /Melody Studio/);
  assert.equal(
    parsed.set2.lines.find((line) => line.line === 17).text,
    "We will train you in the first two weeks."
  );
  const pack = loadPack();
  const profile = itemById(pack, "S2-Q04").profile_text;
  assert.equal(parsed.profile, profile);
  assert.match(profile, /I’m Chris/);
  const glossary = itemById(pack, "S2-Q03").glossary;
  for (const sense of glossary) {
    assert.equal(markdown.includes(sense.definition), true);
    assert.equal(markdown.includes(sense.example), true);
  }
  for (const station of pack.stations) {
    assert.equal(markdown.includes(station.student_stem_en), true);
  }
  const rendered = JSON.stringify(parsed);
  assert.equal(rendered.includes("範例／教師用"), false);
  assert.equal(rendered.includes("not a pupil box"), false);
  assert.equal(rendered.includes("blank line under the introduction"), false);
  assert.equal(rendered.includes("Job descriptions"), false);
});

test("the pupil page uses relative files and does not persist or publish", () => {
  const html = read("index.html").toString("utf8");
  const app = read("js/app.js").toString("utf8");
  const marking = read("js/marking.js").toString("utf8");
  const css = read("css/styles.css").toString("utf8");
  assert.match(html, /href="css\/styles\.css"/);
  assert.match(html, /src="js\/marking\.js"/);
  assert.match(html, /src="js\/passages\.js"/);
  assert.match(html, /src="js\/app\.js"/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js|data)/);
  assert.doesNotMatch(html + css + app, /https?:\/\//);
  assert.match(app, /data\/exercises\.json/);
  assert.match(app, /data\/passages\.md/);
  const pupilSource = html + app + marking + css;
  for (const phrase of [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "serviceWorker",
    "document.cookie",
    "was not supplied",
    "original_item_reason",
    "label_for_site_and_paper",
    "supported_by",
    "CEFR",
  ]) {
    assert.equal(pupilSource.includes(phrase), false, phrase);
  }
  assert.doesNotMatch(app, /\.explanation/);
  assert.equal(fs.existsSync(path.join(root, ".github/workflows")), false);
});
