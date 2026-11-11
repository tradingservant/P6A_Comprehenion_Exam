(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Passages = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SET2_GROUPS = [
    { id: "title", from: 1, to: 2 },
    { id: "storytime", from: 3, to: 11 },
    { id: "cycling", from: 12, to: 17 },
    { id: "music", from: 18, to: 25 },
    { id: "games", from: 26, to: 32 },
    { id: "footer", from: 33, to: 35 },
  ];

  function parseNumberedBlock(block) {
    const lines = [];
    const intro = /^\s*\[box:\s*Introduction\]/i;
    for (const raw of block.split("\n")) {
      if (intro.test(raw)) {
        lines.push({ kind: "introduction" });
        continue;
      }
      const match = raw.match(/^(\s*)(\d+)(\s+)(.*)$/);
      if (!match) continue;
      const line = Number(match[2]);
      const text = match[4].trim();
      const slot = text.match(/^\[Box ([A-E])\b/);
      if (slot) {
        lines.push({ kind: "slot", line: line, slot: slot[1] });
      } else if (/^\(blank line\b/i.test(text)) {
        lines.push({ kind: "blank", line: line });
      } else {
        lines.push({
          kind: "text",
          line: line,
          text: text,
          hanging: match[3].length > 3,
        });
      }
    }
    return lines;
  }

  function fencedBlocks(markdown) {
    const blocks = [];
    const pattern = /```[^\n]*\n([\s\S]*?)```/g;
    let match;
    while ((match = pattern.exec(markdown))) {
      blocks.push(match[1]);
    }
    return blocks;
  }

  function parsePassages(markdown) {
    const blocks = fencedBlocks(markdown);
    if (blocks.length < 2) {
      throw new Error("Passage file is missing the numbered texts.");
    }
    const titleMatch = markdown.match(/\*\*Webpage title\*\*\s+([^\n]+)/);
    const profileMatch = markdown.match(/^>\s*(.+)$/m);
    return {
      set1: {
        title: titleMatch ? titleMatch[1].trim() : "Jobs in the Community: Leisure Centre Lifeguard",
        lines: parseNumberedBlock(blocks[0]),
      },
      set2: {
        title: "Harbour Lights Job Fair",
        lines: parseNumberedBlock(blocks[1]),
      },
      profile: profileMatch ? profileMatch[1].trim() : "",
    };
  }

  return {
    SET2_GROUPS: SET2_GROUPS,
    parsePassages: parsePassages,
  };
});
