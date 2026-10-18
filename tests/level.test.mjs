// Mic level + muted-mic detection used by the popup. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { measure, silenceWatch } from "../extension/lib/level.js";

const tone = (amp, n = 1024) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 3));

test("digital silence measures as level 0", () => {
  const m = measure(new Float32Array(1024));
  assert.equal(m.level, 0);
  assert.equal(m.peak, 0);
});

test("a full-scale tone measures as level 1", () => {
  assert.equal(measure(tone(1)).level, 1);
});

test("speech-loud audio lands mid-scale, room noise near the bottom", () => {
  const speech = measure(tone(0.1)).level; // about -23 dBFS
  const room = measure(tone(0.001)).level; // about -63 dBFS
  assert.ok(speech > 0.5 && speech < 0.8, `speech ${speech}`);
  assert.ok(room < 0.05, `room ${room}`);
});

test("a muted mic is reported silent once the quiet lasts long enough", () => {
  const w = silenceWatch({ after: 1500 });
  assert.equal(w.feed(0, 0), false);
  assert.equal(w.feed(0, 1400), false);
  assert.equal(w.feed(0, 1500), true);
});

test("room noise is not silence: a live mic in a quiet room never warns", () => {
  const w = silenceWatch({ after: 1500 });
  for (let t = 0; t <= 5000; t += 100) assert.equal(w.feed(0.002, t), false);
});

test("sound clears the warning, and silence has to last again before it returns", () => {
  const w = silenceWatch({ after: 1500 });
  w.feed(0, 0);
  assert.equal(w.feed(0, 2000), true);
  assert.equal(w.feed(0.05, 2100), false);
  assert.equal(w.feed(0, 3000), false);
  assert.equal(w.feed(0, 3600), true);
});

import { takeWatch } from "../extension/lib/level.js";

test("a take reports only changes in mic silence, not every sample", () => {
  const changes = [];
  const w = takeWatch({ after: 3000, onChange: (silent) => changes.push(silent) });
  w.feed(0.05, 0);
  w.feed(0, 1000);
  w.feed(0, 4000); // quiet for 3 s: now silent
  w.feed(0, 5000);
  w.feed(0.05, 5100); // sound again
  w.feed(0.05, 6000);
  assert.deepEqual(changes, [true, false]);
});

test("a take remembers whether the mic ever carried sound", () => {
  const quiet = takeWatch({ after: 3000 });
  for (let t = 0; t < 10000; t += 200) quiet.feed(0, t);
  assert.equal(quiet.heard, false);

  const spoke = takeWatch({ after: 3000 });
  spoke.feed(0, 0);
  spoke.feed(0.2, 200);
  spoke.feed(0, 400);
  assert.equal(spoke.heard, true);
});
