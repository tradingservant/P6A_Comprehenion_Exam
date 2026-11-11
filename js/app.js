(function () {
  "use strict";

  const SLOT_IDS = ["A", "B", "C", "D", "E"];
  const STATUS_LABEL = {
    first_correct: "首次答對",
    hinted_success: "提示後答對",
    incorrect: "未答對",
    unanswered: "尚未作答",
    retry: "請再試一次",
  };

  let pack = null;
  let passages = null;
  let state = initialState();
  let dragHeading = "";

  function initialState() {
    return {
      stationId: "set1",
      screenByStation: { set1: 0, set2: 0 },
      headings: { A: "", B: "", C: "", D: "", E: "" },
      choices: {},
      multi: {},
      gaps: {},
      attempts: {},
      notice: "",
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function ready() {
    return Boolean(pack && passages);
  }

  function currentStation() {
    return pack.stations.find(function (station) {
      return station.id === state.stationId;
    });
  }

  function itemById(id) {
    let found = null;
    pack.stations.forEach(function (station) {
      station.items.forEach(function (item) {
        if (item.id === id) found = item;
      });
    });
    return found;
  }

  function currentScreens() {
    return Marking.buildScreens(currentStation());
  }

  function screenIndex() {
    return state.screenByStation[state.stationId] || 0;
  }

  function currentScreen() {
    return currentScreens()[screenIndex()];
  }

  function attemptOf(id) {
    return state.attempts[id] || null;
  }

  function isLocked(id) {
    const attempt = attemptOf(id);
    return Boolean(attempt && attempt.outcome);
  }

  function statusOf(id) {
    const attempt = attemptOf(id);
    if (!attempt || !attempt.attempts) return "unanswered";
    if (attempt.outcome) return attempt.outcome;
    return "retry";
  }

  function attemptCount(id) {
    const attempt = attemptOf(id);
    return attempt && attempt.attempts ? attempt.attempts : 0;
  }

  function outcomeAttribute(id) {
    const attempt = attemptOf(id);
    if (!attempt || !attempt.outcome) return "";
    return ' data-outcome="' + attempt.outcome + '"';
  }

  function itemLabel(id) {
    if (id === "S1-H01") return "Headings";
    const gap = id.match(/^S\d-Q06([a-d])$/);
    if (gap) return "Question 6 (" + gap[1] + ")";
    const question = id.match(/^S\d-Q0*(\d+)$/);
    if (question) return "Question " + Number(question[1]);
    return id;
  }

  function headingBank() {
    const item = itemById("S1-H01");
    return item && item.bank ? item.bank : [];
  }

  function stationHeading(station) {
    if (station.id === "set1") return "Set 1 — Jobs in the Community: Leisure Centre Lifeguard";
    return station.title;
  }

  function settle(item, result) {
    const prev = attemptOf(item.id);
    if (prev && prev.outcome) return;
    const next = Marking.applySubmission(prev, result.correct);
    if (!result.correct && result.firstWrongSlot) next.firstWrongSlot = result.firstWrongSlot;
    state.attempts[item.id] = next;
  }

  function assignHeading(slot, value) {
    if (isLocked("S1-H01")) return;
    const bank = headingBank();
    if (value && bank.indexOf(value) === -1) return;
    if (value === "Introduction") return;
    state.headings[slot] = value;
    if (value) {
      SLOT_IDS.forEach(function (other) {
        if (other !== slot && state.headings[other] === value) state.headings[other] = "";
      });
    }
    render({ preserveScroll: true });
  }

  function readChoice(item) {
    const selected = document.querySelector('input[name="' + CSS.escape(item.id) + '"]:checked');
    if (selected) return selected.value;
    return state.choices[item.id] || "";
  }

  function readMulti(item) {
    const boxes = document.querySelectorAll('input[name="' + CSS.escape(item.id) + '"]');
    if (boxes.length) {
      const values = [];
      boxes.forEach(function (box) {
        if (box.checked) values.push(box.value);
      });
      return values;
    }
    return state.multi[item.id] || [];
  }

  function readGap(id) {
    const input = document.querySelector('input[data-gap="' + id + '"]');
    if (input) return input.value;
    return state.gaps[id] || "";
  }

  function readHeadings(item) {
    const values = {};
    item.slots.forEach(function (slot) {
      const select = document.querySelector('select[data-slot="' + slot.id + '"]');
      values[slot.id] = select ? select.value : state.headings[slot.id] || "";
    });
    return values;
  }

  function submitScreen() {
    if (!ready()) return;
    const screen = currentScreen();
    if (!screen || screen.kind === "review") return;
    if (screen.kind === "gaps") {
      screen.ids.forEach(function (id) {
        const item = itemById(id);
        const value = readGap(id);
        state.gaps[id] = value;
        settle(item, Marking.markItem(item, value));
      });
    } else {
      const item = itemById(screen.ids[0]);
      if (item.type === "heading_match") {
        const values = readHeadings(item);
        SLOT_IDS.forEach(function (slot) {
          if (Object.prototype.hasOwnProperty.call(values, slot)) state.headings[slot] = values[slot];
        });
        settle(item, Marking.markItem(item, values));
      } else if (item.type === "mcq_multi") {
        const values = readMulti(item);
        state.multi[item.id] = values;
        settle(item, Marking.markItem(item, values));
      } else {
        const value = readChoice(item);
        state.choices[item.id] = value;
        settle(item, Marking.markItem(item, value));
      }
    }
    render({ preserveScroll: true });
  }

  function move(delta) {
    const screens = currentScreens();
    const next = screenIndex() + delta;
    if (next < 0 || next >= screens.length) return;
    state.screenByStation[state.stationId] = next;
    state.notice = "";
    render({ preserveScroll: false });
  }

  function jumpReview() {
    const screens = currentScreens();
    state.screenByStation[state.stationId] = screens.length - 1;
    state.notice = "";
    render({ preserveScroll: false });
  }

  function goStation(stationId, where) {
    state.stationId = stationId;
    const screens = Marking.buildScreens(currentStation());
    if (where === "review") state.screenByStation[stationId] = screens.length - 1;
    if (where === "start") state.screenByStation[stationId] = 0;
    state.notice = "";
    render({ preserveScroll: false });
  }

  function resetAll() {
    state = initialState();
    state.notice = "分數已清除。";
    render({ preserveScroll: false });
  }

  function lineRow(line, bodyHtml) {
    return (
      '<div class="ln-row" data-line="' +
      line +
      '"><span class="ln">' +
      line +
      '</span><div class="ln-body">' +
      bodyHtml +
      "</div></div>"
    );
  }

  function textLine(line) {
    const hanging = line.hanging ? " is-hanging" : "";
    return lineRow(
      line.line,
      '<p class="line-text' + hanging + '" lang="en">' + escapeHtml(line.text) + "</p>"
    );
  }

  function renderSlot(slot) {
    const locked = isLocked("S1-H01");
    const value = state.headings[slot] || "";
    let options = '<option value="">請選擇</option>';
    headingBank().forEach(function (heading) {
      if (heading === "Introduction") return;
      const selected = value === heading ? " selected" : "";
      options +=
        '<option value="' +
        escapeHtml(heading) +
        '"' +
        selected +
        ">" +
        escapeHtml(heading) +
        "</option>";
    });
    return (
      '<div class="heading-box" data-drop-slot="' +
      slot +
      '"><label class="box-kicker" for="slot-' +
      slot +
      '">Box ' +
      slot +
      '</label><select id="slot-' +
      slot +
      '" data-slot="' +
      slot +
      '" aria-label="Box ' +
      slot +
      ' heading"' +
      (locked ? " disabled" : "") +
      ">" +
      options +
      "</select></div>"
    );
  }

  function renderSet1() {
    let html =
      '<div class="sheet webpage"><div class="browser-bar" aria-hidden="true"><span></span><span></span><span></span><p>jobs-in-the-community / lifeguard</p></div>';
    html += '<h2 class="sheet-title" lang="en">' + escapeHtml(passages.set1.title) + "</h2>";
    passages.set1.lines.forEach(function (line) {
      if (line.kind === "introduction") {
        html +=
          '<div class="intro-box" data-locked="introduction"><span class="box-kicker">Introduction</span><span class="lock-note">已填寫</span></div>';
        return;
      }
      if (line.kind === "blank") {
        html += lineRow(line.line, '<span class="blank-line"></span>');
        return;
      }
      if (line.kind === "slot") {
        html += lineRow(line.line, renderSlot(line.slot));
        return;
      }
      html += textLine(line);
    });
    html += "</div>";
    return html;
  }

  function renderSet2() {
    let html = '<div class="sheet fair">';
    let gridOpen = false;
    Passages.SET2_GROUPS.forEach(function (group) {
      const inner = passages.set2.lines
        .filter(function (line) {
          return line.line >= group.from && line.line <= group.to;
        })
        .map(textLine)
        .join("");
      if (group.id === "title") {
        html += '<div class="fair-title">' + inner + "</div>";
        return;
      }
      if (group.id === "footer") {
        if (gridOpen) {
          html += "</div>";
          gridOpen = false;
        }
        html += '<footer class="fair-foot">' + inner + "</footer>";
        return;
      }
      if (!gridOpen) {
        html += '<div class="ad-grid">';
        gridOpen = true;
      }
      html += '<article class="ad" data-ad="' + group.id + '">' + inner + "</article>";
    });
    if (gridOpen) html += "</div>";
    html += "</div>";
    return html;
  }

  function renderPassage(station) {
    return station.id === "set1" ? renderSet1() : renderSet2();
  }

  function directionHtml(item) {
    let html = "";
    if (item.direction_zh) html += '<p class="direction">' + escapeHtml(item.direction_zh) + "</p>";
    if (item.direction_en && item.type !== "mcq_multi") {
      html += '<p class="direction-en" lang="en">' + escapeHtml(item.direction_en) + "</p>";
    }
    return html;
  }

  function feedbackHtml(item) {
    const attempt = attemptOf(item.id);
    const mode = Marking.feedbackMode(attempt);
    if (mode === "none") {
      return '<div class="feedback" data-feedback-for="' + item.id + '" tabindex="-1"></div>';
    }
    if (mode === "hint") {
      return (
        '<div class="feedback is-hint" data-feedback-for="' +
        item.id +
        '" tabindex="-1"><p class="status">' +
        STATUS_LABEL.retry +
        "</p><p>" +
        escapeHtml(Marking.hintText(item, attempt)) +
        "</p></div>"
      );
    }
    if (mode === "incorrect_after_retry") {
      return (
        '<div class="feedback is-incorrect" data-feedback-for="' +
        item.id +
        '" tabindex="-1"><p class="status">' +
        STATUS_LABEL.incorrect +
        '</p><p lang="en">' +
        escapeHtml(item.feedback.incorrect_after_retry) +
        "</p></div>"
      );
    }
    const label = mode === "first_correct" ? "正確（首次答對）" : "正確（提示後答對）";
    return (
      '<div class="feedback is-correct" data-feedback-for="' +
      item.id +
      '" tabindex="-1"><p class="status">' +
      label +
      '</p><p lang="en">' +
      escapeHtml(item.feedback.correct) +
      "</p></div>"
    );
  }

  function submitButton(items) {
    const open = items.some(function (item) {
      return !isLocked(item.id);
    });
    if (!open) return '<button type="button" data-action="submit" disabled>已提交</button>';
    return '<button type="button" data-action="submit">提交答案</button>';
  }

  function renderBank(item) {
    const chips = item.bank
      .map(function (heading) {
        if (heading === "Introduction") {
          return '<li class="chip is-locked" data-heading="Introduction" data-locked="true" draggable="false">Introduction<span class="chip-note">已用於網頁</span></li>';
        }
        const used = SLOT_IDS.some(function (slot) {
          return state.headings[slot] === heading;
        });
        return (
          '<li class="chip' +
          (used ? " is-used" : "") +
          '" data-heading="' +
          escapeHtml(heading) +
          '" draggable="' +
          (isLocked(item.id) ? "false" : "true") +
          '">' +
          escapeHtml(heading) +
          (used ? '<span class="chip-note">已選</span>' : "") +
          "</li>"
        );
      })
      .join("");
    return (
      '<div id="heading-bank-wrap"><p class="bank-help">可將小標題拖到文章中的空格，或使用每個空格的下拉清單。鍵盤及觸控請用下拉清單。每個小標題只可使用一次。Introduction 已填妥，無須更改。</p><ul id="heading-bank" aria-label="小標題庫">' +
      chips +
      "</ul></div>"
    );
  }

  function renderOptions(item) {
    const multi = item.type === "mcq_multi";
    const type = multi ? "checkbox" : "radio";
    const chosen = multi ? state.multi[item.id] || [] : [state.choices[item.id]];
    const locked = isLocked(item.id);
    return item.options
      .map(function (option) {
        const checked = chosen.indexOf(option.id) !== -1 ? " checked" : "";
        return (
          '<label class="option"><input type="' +
          type +
          '" name="' +
          escapeHtml(item.id) +
          '" value="' +
          escapeHtml(option.id) +
          '"' +
          checked +
          (locked ? " disabled" : "") +
          '><span class="opt-key">' +
          escapeHtml(option.id) +
          '</span><span lang="en">' +
          escapeHtml(option.text) +
          "</span></label>"
        );
      })
      .join("");
  }

  function renderStatements(item) {
    const rows = item.statements
      .map(function (statement) {
        return '<li value="' + statement.id + '">' + escapeHtml(statement.text) + "</li>";
      })
      .join("");
    return '<ol class="statements" lang="en">' + rows + "</ol>";
  }

  function renderGlossary(item) {
    function group(pos, senses) {
      const rows = senses
        .map(function (sense) {
          return (
            '<li value="' +
            sense.sense +
            '"><p class="def">' +
            escapeHtml(sense.definition) +
            '</p><p class="example" lang="en">' +
            escapeHtml(sense.example) +
            "</p></li>"
          );
        })
        .join("");
      return (
        '<p class="pos-head" lang="en">' +
        escapeHtml(item.target_word) +
        ' <span class="pos">' +
        escapeHtml(pos) +
        "</span></p><ol>" +
        rows +
        "</ol>"
      );
    }
    const nouns = item.glossary.filter(function (sense) {
      return sense.pos === "n";
    });
    const verbs = item.glossary.filter(function (sense) {
      return sense.pos === "v";
    });
    return (
      '<section id="glossary" aria-label="Dictionary"><h3 lang="en">Dictionary</h3>' +
      group("n", nouns) +
      group("v", verbs) +
      "</section>"
    );
  }

  function renderProfile(item) {
    return (
      '<figure class="speech" id="profile"><figcaption>Chris</figcaption><blockquote lang="en">' +
      escapeHtml(item.profile_text) +
      "</blockquote></figure>"
    );
  }

  function renderItem(item) {
    let html =
      '<article class="item" data-item-id="' +
      item.id +
      '" data-attempts="' +
      attemptCount(item.id) +
      '"' +
      outcomeAttribute(item.id) +
      ' data-status="' +
      statusOf(item.id) +
      '">';
    html += "<h3 lang=\"en\">" + escapeHtml(itemLabel(item.id)) + "</h3>";
    html += directionHtml(item);
    if (item.stem) html += '<p class="stem" lang="en">' + escapeHtml(item.stem) + "</p>";
    if (item.type === "mcq_multi") {
      html +=
        '<p class="choose-many"><span lang="en">' +
        escapeHtml(item.direction_en) +
        "</span>／你可以選擇多於一個答案。</p>";
    }
    if (item.type === "heading_match") html += renderBank(item);
    if (item.type === "mcq_combination") html += renderStatements(item);
    if (item.type === "dictionary_sense") {
      if (item.target_context) {
        html += '<p class="target-context" lang="en">' + escapeHtml(item.target_context) + "</p>";
      }
      html += renderGlossary(item);
    }
    if (item.profile_text) html += renderProfile(item);
    if (item.options) html += '<div class="options">' + renderOptions(item) + "</div>";
    html += feedbackHtml(item);
    html += submitButton([item]);
    html += "</article>";
    return html;
  }

  function noteCopy(station, screen, items) {
    const group = station.items.find(function (item) {
      return item.id === screen.noteId && item.note_full;
    });
    const fallback = items.find(function (item) {
      return item.note_full;
    });
    const source = group || fallback;
    return {
      note: source.note_full,
      direction_zh: (group && group.direction_zh) || items[0].direction_zh || "",
      direction_en: (group && group.direction_en) || items[0].direction_en || "",
    };
  }

  function renderGaps(station, screen) {
    const items = screen.ids.map(itemById);
    const copy = noteCopy(station, screen, items);
    let noteHtml = "";
    Marking.splitNote(copy.note).forEach(function (part) {
      if (part.type === "text") {
        noteHtml += escapeHtml(part.text).replace(/\n/g, "<br>");
        return;
      }
      const item = items.find(function (candidate) {
        return candidate.blank_number === part.n;
      });
      const value = state.gaps[item.id] || "";
      noteHtml +=
        '<span class="gap">(' +
        part.n +
        ') <input data-gap="' +
        item.id +
        '" type="text" lang="en" value="' +
        escapeHtml(value) +
        '" aria-label="第 ' +
        part.n +
        ' 個空格，只填一個單詞" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"' +
        (isLocked(item.id) ? " disabled" : "") +
        "></span>";
    });
    const feedback = items
      .map(function (item) {
        return (
          '<li data-item-id="' +
          item.id +
          '" data-attempts="' +
          attemptCount(item.id) +
          '"' +
          outcomeAttribute(item.id) +
          ' data-status="' +
          statusOf(item.id) +
          '"><p class="gap-label">(' +
          item.blank_number +
          ")</p>" +
          feedbackHtml(item) +
          "</li>"
        );
      })
      .join("");
    return (
      '<article class="item" data-screen="gaps"><h3 lang="en">Question 6</h3><p class="direction">' +
      escapeHtml(copy.direction_zh) +
      '</p><p class="direction-en" lang="en">' +
      escapeHtml(copy.direction_en) +
      '</p><div class="note" lang="en">' +
      noteHtml +
      '</div><ul class="gap-results">' +
      feedback +
      "</ul>" +
      submitButton(items) +
      "</article>"
    );
  }

  function renderReview(station, screen) {
    const score = Marking.scoreStation(station.items, state.attempts);
    const unfinished = screen.ids.some(function (id) {
      return !isLocked(id);
    });
    const rows = screen.ids
      .map(function (id) {
        const status = statusOf(id);
        const outcome = status === "retry" ? "unanswered" : status;
        return (
          '<li data-review-id="' +
          id +
          '" data-outcome="' +
          outcome +
          '"><span lang="en">' +
          escapeHtml(itemLabel(id)) +
          "</span>：" +
          STATUS_LABEL[status] +
          "</li>"
        );
      })
      .join("");
    const lead = unfinished
      ? "尚有題目未完成。你可以返回題目，或自行進入下一組。"
      : "你可以先檢視各題結果，再決定是否離開這一組。";
    let actions = "";
    if (station.id === "set1") {
      actions = '<button type="button" data-action="continue" id="continue-set2">繼續第二組</button>';
    } else {
      actions = '<button type="button" class="secondary" data-action="back-set1" id="back-set1">返回第一組</button>';
    }
    return (
      '<article class="item review"><h3>本組檢視</h3><p>' +
      lead +
      '</p><p class="quiet">以下只列出各題結果，不設總評等級。</p><p class="score-line">本組得分 ' +
      score.earned +
      " / " +
      score.total +
      '</p><ol id="review-list">' +
      rows +
      "</ol>" +
      actions +
      "</article>"
    );
  }

  function renderNav(screens, index) {
    const onReview = screens[index].kind === "review";
    const prevLabel = onReview ? "返回題目" : "上一題";
    const prevDisabled = index === 0 ? " disabled" : "";
    const review = onReview
      ? ""
      : '<button type="button" class="secondary" data-action="review">本組檢視</button>';
    const next = onReview ? "" : '<button type="button" class="secondary" data-action="next">下一題</button>';
    const back =
      state.stationId === "set2" && !onReview
        ? '<button type="button" class="secondary" data-action="back-set1">返回第一組</button>'
        : "";
    return (
      '<div class="nav"><button type="button" class="secondary" data-action="prev"' +
      prevDisabled +
      ">" +
      prevLabel +
      "</button>" +
      review +
      next +
      back +
      "</div>"
    );
  }

  function renderQuestions(station) {
    const screens = Marking.buildScreens(station);
    const index = Math.min(screenIndex(), screens.length - 1);
    state.screenByStation[station.id] = index;
    const screen = screens[index];
    const score = Marking.scoreStation(station.items, state.attempts);
    let html = '<p id="notice"' + (state.notice ? "" : " hidden") + ">" + escapeHtml(state.notice) + "</p>";
    html += '<p class="station-kicker">' + (station.order === 1 ? "第一組" : "第二組") + "</p>";
    html += '<h2 class="station-title" lang="en">' + escapeHtml(stationHeading(station)) + "</h2>";
    html += '<p class="station-zh">' + escapeHtml(station.title_zh) + "</p>";
    html += '<p class="exam-stem" lang="en">' + escapeHtml(station.student_stem_en) + "</p>";
    html += '<p class="direction">' + escapeHtml(station.student_stem_zh) + "</p>";
    html += '<p class="progress">已完成 ' + score.done + " / " + score.count + " 題</p>";
    if (screen.kind === "review") html += renderReview(station, screen);
    else if (screen.kind === "gaps") html += renderGaps(station, screen);
    else html += renderItem(itemById(screen.ids[0]));
    html += renderNav(screens, index);
    return { html: html, screen: screen };
  }

  function revealPassageLine(lineNo) {
    const pane = document.getElementById("passage");
    const row = pane && pane.querySelector('[data-line="' + lineNo + '"]');
    if (!row) return;
    const paneRect = pane.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    pane.scrollTop += rowRect.top - paneRect.top - pane.clientHeight / 2 + rowRect.height / 2;
  }

  function updateScore(station) {
    const score = Marking.scoreStation(station.items, state.attempts);
    const el = document.getElementById("score");
    el.dataset.earned = String(score.earned);
    el.dataset.total = String(score.total);
    el.dataset.done = String(score.done);
    el.dataset.station = station.id;
    el.dataset.scoredCount = String(score.count);
    el.textContent = (station.order === 1 ? "第一組" : "第二組") + "得分 " + score.earned + " / " + score.total;
    document.getElementById("workspace").dataset.station = station.id;
  }

  function render(options) {
    if (!ready()) return;
    const opts = options || {};
    const station = currentStation();
    const passage = document.getElementById("passage");
    const questions = document.getElementById("questions");
    const passageScroll = opts.preserveScroll ? passage.scrollTop : 0;
    const questionScroll = opts.preserveScroll ? questions.scrollTop : 0;
    const built = renderQuestions(station);
    passage.innerHTML = renderPassage(station);
    questions.innerHTML = built.html;
    questions.dataset.kind = built.screen.kind;
    questions.dataset.screen = (built.screen.ids || []).join(" ");
    if (opts.preserveScroll) {
      passage.scrollTop = passageScroll;
      questions.scrollTop = questionScroll;
    }
    if (built.screen.ids && built.screen.ids.indexOf("S2-Q03") !== -1) revealPassageLine(17);
    updateScore(station);
    const live = document.getElementById("live");
    if (live) live.textContent = state.notice || "";
    document.getElementById("pack-title").textContent = pack.title;
    document.getElementById("pack-title-zh").textContent = pack.title_zh;
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === "submit") submitScreen();
    else if (action === "next") move(1);
    else if (action === "prev") move(-1);
    else if (action === "review") jumpReview();
    else if (action === "continue") goStation("set2", "start");
    else if (action === "back-set1") goStation("set1", "review");
    else if (action === "reset") resetAll();
  });

  document.addEventListener("change", function (event) {
    const target = event.target;
    if (target.matches("select[data-slot]")) {
      assignHeading(target.dataset.slot, target.value);
    } else if (target.matches('input[type="radio"]')) {
      state.choices[target.name] = target.value;
    } else if (target.matches('input[type="checkbox"]')) {
      const values = [];
      document.querySelectorAll('input[name="' + CSS.escape(target.name) + '"]').forEach(function (box) {
        if (box.checked) values.push(box.value);
      });
      state.multi[target.name] = values;
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target.matches("input[data-gap]")) {
      state.gaps[event.target.dataset.gap] = event.target.value;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.matches("input[data-gap]")) {
      event.preventDefault();
      submitScreen();
    }
  });

  document.addEventListener("dragstart", function (event) {
    const chip = event.target.closest("[data-heading]");
    if (!chip || chip.dataset.locked === "true" || isLocked("S1-H01")) {
      event.preventDefault();
      return;
    }
    dragHeading = chip.dataset.heading || "";
    if (event.dataTransfer) {
      try {
        event.dataTransfer.setData("text/plain", dragHeading);
        event.dataTransfer.effectAllowed = "copy";
      } catch (error) {
        dragHeading = chip.dataset.heading || "";
      }
    }
  });

  document.addEventListener("dragover", function (event) {
    if (event.target.closest("[data-drop-slot]")) event.preventDefault();
  });

  document.addEventListener("drop", function (event) {
    const box = event.target.closest("[data-drop-slot]");
    if (!box) return;
    event.preventDefault();
    let heading = "";
    if (event.dataTransfer) {
      try {
        heading = event.dataTransfer.getData("text/plain");
      } catch (error) {
        heading = "";
      }
    }
    if (!heading) heading = dragHeading;
    dragHeading = "";
    if (!heading) return;
    assignHeading(box.dataset.dropSlot, heading);
  });

  function showLoadError() {
    document.getElementById("questions").innerHTML =
      '<p class="feedback is-incorrect">未能載入練習內容。請以網站方式開啟本頁。</p>';
  }

  fetch("data/exercises.json")
    .then(function (response) {
      if (!response.ok) throw new Error("exercises");
      return response.json();
    })
    .then(function (loadedPack) {
      pack = loadedPack;
      return fetch("data/passages.md");
    })
    .then(function (response) {
      if (!response.ok) throw new Error("passages");
      return response.text();
    })
    .then(function (markdown) {
      passages = Passages.parsePassages(markdown);
      document.title = pack.title;
      render({ preserveScroll: false });
    })
    .catch(showLoadError);
})();
