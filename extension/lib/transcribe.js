// Transcription by a model running on this computer. Tape only speaks the common
// OpenAI-style endpoint (POST {url}/v1/audio/transcriptions), so any local server works:
// the bundled Parakeet Redux server (transcribe/), whisper.cpp, Speaches, LocalAI.
// The audio never goes anywhere else.

import { getSettings } from "./settings.js";
import { updateRecording } from "./db.js";
import { encodeWav, parseTranscription } from "./transcript.js";

const RATE = 16000;
const trim = (u) => (u || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");

export const transcriberReady = (settings) => !!trim(settings.transcribe.url);

/** The recording's sound as 16 kHz mono WAV: small, and every speech model reads it. */
export async function extractAudio(blob) {
  const ctx = new AudioContext();
  let audio;
  try {
    audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error("This recording has no sound to transcribe.");
  } finally {
    ctx.close().catch(() => {});
  }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return new Blob([encodeWav(out.getChannelData(0), RATE)], { type: "audio/wav" });
}

const headers = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

/** Lists the server's models, or explains why it can't be reached. */
export async function testTranscriber(url, key) {
  const base = trim(url);
  let res;
  try {
    res = await fetch(`${base}/v1/models`, { headers: headers(key) });
  } catch {
    throw new Error(`Nothing is answering at ${base}. Is the model server running?`);
  }
  if (res.status === 401 || res.status === 403) throw new Error("The server wants an API key.");
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  return (json.data || []).map((m) => m.id).filter(Boolean);
}

const setTranscript = (id, value) => updateRecording(id, { transcript: value });

export async function transcribeRecording(id, blob) {
  const { transcribe: cfg } = await getSettings();
  const base = trim(cfg.url);
  if (!base) throw new Error("Connect a local model in Settings first.");
  await setTranscript(id, { state: "working", at: Date.now() });
  try {
    const wav = await extractAudio(blob);
    const form = new FormData();
    form.append("file", wav, "audio.wav");
    form.append("model", cfg.model || "parakeet-redux");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    form.append("timestamp_granularities[]", "word");
    let res;
    try {
      res = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: headers(cfg.key), body: form });
    } catch {
      throw new Error(`Nothing is answering at ${base}. Start your model server and try again.`);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message || json?.error || `The model server answered ${res.status}.`);
    const t = parseTranscription(json);
    return setTranscript(id, { state: "done", ...t, model: json.model || cfg.model || "local model", at: Date.now() });
  } catch (e) {
    return setTranscript(id, { state: "error", error: e.message });
  }
}


const LOCAL_TRANSCRIBER = "http://127.0.0.1:8790";

/** Tape's own Parakeet Redux server, if it's running on this computer (answers in < 1 s). */
export async function detectLocalTranscriber() {
  try {
    const res = await fetch(`${LOCAL_TRANSCRIBER}/health`, { signal: AbortSignal.timeout(800) });
    const json = await res.json();
    return res.ok && json.ok ? { url: LOCAL_TRANSCRIBER, model: json.model || "" } : null;
  } catch {
    return null;
  }
}
