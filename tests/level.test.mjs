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

import { spectrumBars, ease } from "../extension/lib/level.js";

// A flat spectrum at `db` across all bins.
const flat = (db, n = 512) => new Float32Array(n).fill(db);

test("spectrum bars are 0 for silence and 1 at full level", () => {
  const opts = { bars: 8, sampleRate: 48000, fftSize: 1024, minDb: -90, maxDb: -20 };
  assert.deepEqual(spectrumBars(flat(-Infinity), opts), new Array(8).fill(0));
  assert.deepEqual(spectrumBars(flat(-10), opts), new Array(8).fill(1));
});

test("spectrum bars follow the voice: a low tone lifts the first bars, not the last", () => {
  const sampleRate = 48000, fftSize = 1024, hz = sampleRate / fftSize; // ~47 Hz per bin
  const spec = flat(-100);
  for (let i = Math.floor(150 / hz); i <= Math.ceil(250 / hz); i++) spec[i] = -25; // a hum around 200 Hz
  const bars = spectrumBars(spec, { bars: 10, sampleRate, fftSize, minHz: 100, maxHz: 5000, minDb: -90, maxDb: -20 });
  assert.ok(bars[0] > 0.8 || bars[1] > 0.8, `low bars ${bars.slice(0, 3)}`);
  assert.equal(bars[9], 0);
});

test("ease rises quickly and falls slowly, so bars jump with speech and settle", () => {
  const up = ease(0, 1);
  const down = ease(1, 0);
  assert.ok(up > 0.4, `up ${up}`);
  assert.ok(down > 0.75, `down ${down}`);
});
