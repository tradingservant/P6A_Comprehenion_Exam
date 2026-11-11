(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Marking = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function isScoredItem(item) {
    if (!item || typeof item !== "object") return false;
    if (item.scored === false) return false;
    if (item.role === "display_group") return false;
    if (item.type === "gap_note_group") return false;
    if (typeof item.marks !== "number" || !(item.marks > 0)) return false;
    return true;
  }

  function scoredItems(pack) {
    const items = [];
    (pack.stations || []).forEach(function (station) {
      (station.items || []).forEach(function (item) {
        if (isScoredItem(item)) items.push(item);
      });
    });
    return items;
  }

  function markGap(item, raw) {
    const text = String(raw == null ? "" : raw).trim();
    if (!text || /\s/.test(text)) return { correct: false };
    const folded = text.toLowerCase();
    const accepted = Array.isArray(item.accepted) ? item.accepted : [];
    const correct = accepted.some(function (answer) {
      return String(answer).toLowerCase() === folded;
    });
    return { correct: correct };
  }

  function markChoice(item, raw) {
    const value = String(raw == null ? "" : raw).trim();
    const accepted = Array.isArray(item.accepted) ? item.accepted : [];
    return {
      correct: accepted.some(function (answer) {
        return String(answer) === value;
      }),
    };
  }

  function markMulti(item, raw) {
    const given = Array.isArray(raw) ? raw : [];
    const got = [];
    given.forEach(function (value) {
      const text = String(value == null ? "" : value).trim();
      if (text && got.indexOf(text) === -1) got.push(text);
    });
    got.sort();
    const want = (Array.isArray(item.accepted) ? item.accepted : []).map(function (value) {
      return String(value);
    });
    want.sort();
    const correct = got.length === want.length && got.every(function (value, index) {
      return value === want[index];
    });
    return { correct: correct };
  }

  function markHeading(item, raw) {
    const values = raw && typeof raw === "object" ? raw : {};
    let firstWrongSlot = null;
    (item.slots || []).forEach(function (slot) {
      const value = String(values[slot.id] == null ? "" : values[slot.id]).trim();
      const ok = (slot.accepted || []).some(function (answer) {
        return answer === value;
      });
      if (!ok && !firstWrongSlot) firstWrongSlot = slot.id;
    });
    return { correct: firstWrongSlot == null, firstWrongSlot: firstWrongSlot };
  }

  function markItem(item, answer) {
    if (item.type === "one_word_gap") return markGap(item, answer);
    if (item.type === "mcq_multi") return markMulti(item, answer);
    if (item.type === "heading_match") return markHeading(item, answer);
    if (item.type === "mcq_single" || item.type === "mcq_combination" || item.type === "dictionary_sense") {
      return markChoice(item, answer);
    }
    return { correct: false };
  }

  function applySubmission(prev, correct) {
    const state = {
      attempts: prev && prev.attempts ? prev.attempts : 0,
      outcome: prev && prev.outcome ? prev.outcome : null,
      hintShown: Boolean(prev && prev.hintShown),
    };
    if (state.outcome) return state;
    if (!correct) {
      if (state.attempts >= 1) {
        return { attempts: state.attempts + 1, outcome: "incorrect", hintShown: true };
      }
      return { attempts: 1, outcome: null, hintShown: true };
    }
    const hadHint = state.hintShown || state.attempts > 0;
    if (!hadHint) {
      return { attempts: 1, outcome: "first_correct", hintShown: false };
    }
    return { attempts: state.attempts + 1, outcome: "hinted_success", hintShown: true };
  }

  function hintText(item, attempt) {
    if (item.type === "heading_match" && attempt && attempt.firstWrongSlot && item.hint_by_first_wrong_slot) {
      const specific = item.hint_by_first_wrong_slot[attempt.firstWrongSlot];
      if (specific) return specific;
    }
    return item.hints && item.hints.first_error ? item.hints.first_error : "";
  }

  function feedbackMode(attempt) {
    if (!attempt || !attempt.attempts) return "none";
    if (attempt.outcome === "first_correct") return "first_correct";
    if (attempt.outcome === "hinted_success") return "hinted_success";
    if (attempt.outcome === "incorrect") return "incorrect_after_retry";
    return "hint";
  }

  function splitNote(note) {
    const pattern = /\((\d+)\)\s*_{2,}/g;
    const parts = [];
    let last = 0;
    let match;
    while ((match = pattern.exec(note))) {
      parts.push({ type: "text", text: note.slice(last, match.index) });
      parts.push({ type: "blank", n: Number(match[1]) });
      last = match.index + match[0].length;
    }
    parts.push({ type: "text", text: note.slice(last) });
    return parts;
  }

  function buildScreens(station) {
    const items = (station.items || []).filter(isScoredItem);
    const screens = [];
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      if (item.type === "one_word_gap") {
        const ids = [];
        const noteId = item.part_of_note;
        while (
          index < items.length &&
          items[index].type === "one_word_gap" &&
          items[index].part_of_note === noteId
        ) {
          ids.push(items[index].id);
          index += 1;
        }
        screens.push({ kind: "gaps", ids: ids, noteId: noteId });
      } else {
        screens.push({ kind: "item", ids: [item.id] });
        index += 1;
      }
    }
    screens.push({
      kind: "review",
      ids: items.map(function (item) {
        return item.id;
      }),
    });
    return screens;
  }

  function scoreStation(items, attempts) {
    const scored = (items || []).filter(isScoredItem);
    let earned = 0;
    let done = 0;
    scored.forEach(function (item) {
      const record = attempts && attempts[item.id];
      const outcome = record && record.outcome;
      if (outcome === "first_correct" || outcome === "hinted_success") earned += item.marks;
      if (outcome) done += 1;
    });
    const total = scored.reduce(function (sum, item) {
      return sum + item.marks;
    }, 0);
    return {
      earned: earned,
      total: total,
      done: done,
      count: scored.length,
      ids: scored.map(function (item) {
        return item.id;
      }),
    };
  }

  return {
    isScoredItem: isScoredItem,
    scoredItems: scoredItems,
    markItem: markItem,
    applySubmission: applySubmission,
    hintText: hintText,
    feedbackMode: feedbackMode,
    splitNote: splitNote,
    buildScreens: buildScreens,
    scoreStation: scoreStation,
  };
});
