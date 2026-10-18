// Mic level for the popup's waveform, and muted-mic detection.
// A hardware mute (a mic's own button) sends digital silence, while a live mic in a
// quiet room still carries a little noise, so "silent" means near-zero samples.

const FLOOR_DB = -60;
const CEIL_DB = -6;

/** RMS, peak and a 0..1 display level (-60 dBFS to -6 dBFS) of time-domain samples. */
export function measure(samples) {
  let sum = 0;
  let peak = 0;
  for (const s of samples) {
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const level = Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
  return { rms, peak, level };
}

/** feed(peak, nowMs) is true once the peak has stayed at or under `floor` for `after` ms. */
export function silenceWatch({ floor = 1e-4, after = 1500 } = {}) {
  let lastSound = null;
  return {
    feed(peak, now) {
      if (lastSound === null || peak > floor) lastSound = now;
      return now - lastSound >= after;
    },
  };
}

/** For a running take: calls onChange(silent) when the mic goes silent or comes back, and
 *  remembers in `heard` whether it ever carried sound (a whole take with none was muted). */
export function takeWatch({ floor = 1e-4, after = 3000, onChange } = {}) {
  const watch = silenceWatch({ floor, after });
  let silent = false;
  return {
    heard: false,
    feed(peak, now) {
      if (peak > floor) this.heard = true;
      const next = watch.feed(peak, now);
      if (next !== silent) onChange?.((silent = next));
      return silent;
    },
  };
}

/** Frequency data (dB per bin) to `bars` values 0..1, log-spaced across the voice range,
 *  each bar the loudest bin in its band. */
export function spectrumBars(db, { bars, sampleRate, fftSize, minHz = 100, maxHz = 5000, minDb = -90, maxDb = -25 }) {
  const hzPerBin = sampleRate / fftSize;
  const out = [];
  for (let b = 0; b < bars; b++) {
    const f0 = minHz * (maxHz / minHz) ** (b / bars);
    const f1 = minHz * (maxHz / minHz) ** ((b + 1) / bars);
    const i0 = Math.max(0, Math.floor(f0 / hzPerBin));
    const i1 = Math.min(db.length - 1, Math.max(i0, Math.ceil(f1 / hzPerBin) - 1));
    let peak = -Infinity;
    for (let i = i0; i <= i1; i++) if (db[i] > peak) peak = db[i];
    out.push(Math.min(1, Math.max(0, (peak - minDb) / (maxDb - minDb))));
  }
  return out;
}

/** One animation step toward `next`: quick to rise, slow to fall. */
export const ease = (prev, next) => prev + (next - prev) * (next > prev ? 0.55 : 0.15);
