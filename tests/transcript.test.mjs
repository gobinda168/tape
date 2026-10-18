// Transcription helpers: WAV encoding for any local model server, and reading its reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, parseTranscription, transcriptText } from "../extension/lib/transcript.js";

test("encodeWav writes a 16-bit mono PCM WAV any server can read", () => {
  const buf = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 16000);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), "RIFF");
  assert.equal(str(8, 4), "WAVE");
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16); // bits
  assert.equal(v.getUint32(40, true), 8); // 4 samples x 2 bytes
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)], [0, 32767, -32768, 16384]);
});

test("an OpenAI-style verbose reply keeps its timed segments", () => {
  const t = parseTranscription({ text: "Hi there. Bye.", segments: [{ start: 0.3, end: 1.2, text: " Hi there." }, { start: 1.2, end: 2, text: " Bye." }] });
  assert.deepEqual(t.segments, [{ start: 0.3, end: 1.2, text: "Hi there." }, { start: 1.2, end: 2, text: "Bye." }]);
  assert.equal(t.text, "Hi there. Bye.");
});

test("a reply with only words is grouped into sentences", () => {
  const words = [["Hi", 0, 0.2], ["there.", 0.2, 0.5], ["Bye", 0.9, 1.1], ["now.", 1.1, 1.4]].map(([word, start, end]) => ({ word, start, end }));
  const t = parseTranscription({ text: "Hi there. Bye now.", words });
  assert.deepEqual(t.segments, [{ start: 0, end: 0.5, text: "Hi there." }, { start: 0.9, end: 1.4, text: "Bye now." }]);
});

test("a plain-text reply becomes one untimed segment", () => {
  const t = parseTranscription({ text: "  just words  " });
  assert.deepEqual(t.segments, [{ start: 0, end: null, text: "just words" }]);
});

test("an empty reply says nothing was heard", () => {
  assert.throws(() => parseTranscription({ text: "" }), /didn't hear any speech/);
});

test("the copied transcript has a timestamp per line", () => {
  const out = transcriptText({ segments: [{ start: 3.2, end: 5, text: "Hello." }, { start: 65, end: 70, text: "Next." }] });
  assert.equal(out, "[0:03] Hello.\n[1:05] Next.");
});
