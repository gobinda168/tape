// Title + summary from a local LLM: prompt building, chunking long transcripts, reading replies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { transcriptLines, chunkSegments, parseSummary, messagesFor, mergeMessages } from "../extension/lib/summary.js";

const segs = [
  { start: 0, end: 3, text: "Today I'll walk through the new recorder." },
  { start: 65, end: 70, text: "Next, the popup warns when the mic is muted." },
];

test("the model reads the transcript as timestamped lines", () => {
  assert.equal(transcriptLines(segs), "[0:00] Today I'll walk through the new recorder.\n[1:05] Next, the popup warns when the mic is muted.");
});

test("a long transcript splits into chunks at line boundaries, none over the budget", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: "word ".repeat(30).trim() }));
  const chunks = chunkSegments(many, 1200);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flat().length, 50);
  for (const c of chunks) assert.ok(transcriptLines(c).length <= 1200);
});

test("a short transcript stays one chunk", () => {
  assert.equal(chunkSegments(segs, 12000).length, 1);
});

test("the prompt asks for JSON and carries the whole transcript", () => {
  const m = messagesFor(segs);
  assert.equal(m[0].role, "system");
  assert.match(m[0].content, /JSON/);
  assert.match(m[1].content, /\[1:05\] Next, the popup/);
});

test("merging section notes keeps every section's summary", () => {
  const m = mergeMessages([{ summary: "A part." }, { summary: "B part." }]);
  assert.match(m[1].content, /A part\./);
  assert.match(m[1].content, /B part\./);
});

test("a JSON reply becomes a clean summary with chapters in seconds", () => {
  const s = parseSummary(`Sure! Here it is:
\`\`\`json
{"title": "\\"Walkthrough of the new recorder.\\"", "summary": "A tour.", "key_points": ["Never loses a take", " Mic warning "], "chapters": [{"start": "1:05", "title": "Mic warning"}, {"start": "0:00", "title": "Intro"}]}
\`\`\``);
  assert.equal(s.title, "Walkthrough of the new recorder");
  assert.equal(s.summary, "A tour.");
  assert.deepEqual(s.keyPoints, ["Never loses a take", "Mic warning"]);
  assert.deepEqual(s.chapters, [{ start: 0, title: "Intro" }, { start: 65, title: "Mic warning" }]);
});

test("a thinking model's reasoning is ignored", () => {
  const s = parseSummary(`<think>The user wants {"title": "wrong"}</think>{"title": "Right title", "summary": "Ok."}`);
  assert.equal(s.title, "Right title");
});

test("a reply that isn't JSON is reported, not shown as a summary", () => {
  assert.throws(() => parseSummary("I cannot help with that."), /didn't return a summary/);
});
