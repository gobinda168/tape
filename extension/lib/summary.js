// Title, summary, key points and chapters from a local LLM, as pure functions: the prompt,
// splitting long transcripts for small context windows, and reading the model's reply.

import { stamp } from "./transcript.js";

export const transcriptLines = (segments) => segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join("\n");

/** Consecutive runs of segments whose lines fit in `budget` characters. */
export function chunkSegments(segments, budget = 12000) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const s of segments) {
    const len = `[${stamp(s.start)}] ${s.text}`.length + 1;
    if (cur.length && size + len > budget) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const SHAPE = `{"title": "...", "summary": "...", "key_points": ["..."], "chapters": [{"start": "m:ss", "title": "..."}]}`;
const RULES = [
  "title: what the recording is about, at most 8 words, no quotes, no full stop.",
  "summary: 2 to 4 plain sentences on what was shown and said.",
  "key_points: 3 to 6 short points, most important first.",
  "chapters: only when the recording has distinct parts; each start is a timestamp copied from the transcript; otherwise [].",
  "Write in the language of the transcript. Use only what was said; never invent details.",
].join("\n");

/** One request for a transcript that fits the model's context. */
export const messagesFor = (segments) => [
  { role: "system", content: `You summarise screen recordings from their transcript. Reply with one JSON object and nothing else, shaped like ${SHAPE}\n${RULES}` },
  { role: "user", content: `Transcript:\n${transcriptLines(segments)}` },
];

/** Notes on one part of a long recording, merged later. */
export const sectionMessages = (segments, part, parts) => [
  { role: "system", content: `You take notes on part ${part} of ${parts} of a screen recording's transcript. Reply with one JSON object and nothing else, shaped like {"summary": "...", "key_points": ["..."], "chapters": [{"start": "m:ss", "title": "..."}]}\nsummary: 1 to 3 sentences. chapters: timestamps copied from the transcript, only where the topic changes. Use only what was said.` },
  { role: "user", content: `Transcript, part ${part} of ${parts}:\n${transcriptLines(segments)}` },
];

/** Combine per-part notes into the final title and summary. */
export const mergeMessages = (notes) => [
  { role: "system", content: `You summarise screen recordings from notes on each part, in order. Reply with one JSON object and nothing else, shaped like ${SHAPE}\n${RULES}\nKeep chapter timestamps exactly as given.` },
  {
    role: "user",
    content: notes.map((n, i) => [
      `Part ${i + 1}: ${n.summary || ""}`,
      n.keyPoints?.length ? `Points: ${n.keyPoints.join("; ")}` : "",
      n.chapters?.length ? `Chapters: ${n.chapters.map((c) => `[${stamp(c.start)}] ${c.title}`).join("; ")}` : "",
    ].filter(Boolean).join("\n")).join("\n\n"),
  },
];

const seconds = (v) => {
  if (typeof v === "number") return v;
  const parts = String(v || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};
const tidy = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** The model's text to { title, summary, keyPoints, chapters }. Tolerates fences, chatter and <think>. */
export function parseSummary(text) {
  const body = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  let json = null;
  if (first !== -1 && last > first) {
    try { json = JSON.parse(body.slice(first, last + 1)); } catch {}
  }
  if (!json || (!json.title && !json.summary)) throw new Error("The model didn't return a summary. Try again, or pick a larger model.");
  const title = tidy(json.title).replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.。]+$/, "").slice(0, 80);
  const points = json.key_points || json.keyPoints || [];
  const chapters = (Array.isArray(json.chapters) ? json.chapters : [])
    .map((c) => ({ start: seconds(c.start ?? c.time), title: tidy(c.title) }))
    .filter((c) => c.start !== null && c.start >= 0 && c.title)
    .sort((a, b) => a.start - b.start)
    .filter((c, i, all) => i === 0 || c.start !== all[i - 1].start);
  return {
    title,
    summary: tidy(json.summary),
    keyPoints: (Array.isArray(points) ? points : []).map(tidy).filter(Boolean),
    chapters,
  };
}
