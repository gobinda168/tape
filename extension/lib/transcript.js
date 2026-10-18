// Transcripts, as pure functions: audio out to any local model server as a WAV, and its
// reply (OpenAI-style verbose_json, words only, or plain text) back into timed segments.

/** 16-bit mono PCM WAV of `samples` (-1..1). */
export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const put = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return buf;
}

const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();

/** Any server's reply to { text, segments: [{ start, end, text }] }. */
export function parseTranscription(json) {
  const text = clean(json?.text);
  let segments = [];
  if (Array.isArray(json?.segments) && json.segments.length) {
    segments = json.segments.map((s) => ({ start: +s.start || 0, end: s.end == null ? null : +s.end, text: clean(s.text) }));
  } else if (Array.isArray(json?.words) && json.words.length) {
    // Words only: close a sentence at . ? ! or a pause longer than a second.
    let cur = null;
    json.words.forEach((w, i) => {
      const word = clean(w.word ?? w.text);
      if (!cur) cur = { start: +w.start, end: +w.end, text: word };
      else { cur.end = +w.end; cur.text += " " + word; }
      const next = json.words[i + 1];
      if (/[.?!]$/.test(word) || !next || +next.start - +w.end > 1) { segments.push(cur); cur = null; }
    });
  } else if (text) {
    segments = [{ start: 0, end: null, text }];
  }
  segments = segments.filter((s) => s.text);
  if (!segments.length) throw new Error("The model didn't hear any speech in this recording.");
  return { text: text || segments.map((s) => s.text).join(" "), segments };
}

const stamp = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
export { stamp };

/** Plain text to paste anywhere: "[m:ss] sentence" per line. */
export const transcriptText = (t) => t.segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join("\n");
