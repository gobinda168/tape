// Title and summary by a language model running on this computer. Tape speaks the common
// OpenAI-style POST {url}/v1/chat/completions, so Ollama, LM Studio, llama.cpp's server
// and MLX servers all work. The transcript never goes anywhere else.

import { getSettings } from "./settings.js";
import { getRecording, updateRecording } from "./db.js";
import { chunkSegments, messagesFor, sectionMessages, mergeMessages, parseSummary } from "./summary.js";

const trim = (u) => (u || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
const headers = (key) => ({ "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) });

export const llmReady = (settings) => !!(trim(settings.llm.url) && settings.llm.model);

/** The server's model names, or why it can't be reached. */
export async function testLLM(url, key) {
  const base = trim(url);
  let res;
  try {
    res = await fetch(`${base}/v1/models`, { headers: headers(key) });
  } catch {
    throw new Error(`Nothing is answering at ${base}. Is Ollama (or your model server) running?`);
  }
  if (res.status === 401 || res.status === 403) throw new Error("The server wants an API key.");
  if (!res.ok) throw new Error(`The server answered ${res.status}. Use its OpenAI-compatible address, for example http://127.0.0.1:11434/v1 for Ollama.`);
  const json = await res.json().catch(() => ({}));
  return (json.data || []).map((m) => m.id).filter(Boolean);
}

/** A one-token request to the model: proves the key and model name actually work. */
export async function pingLLM(url, key, model) {
  const base = trim(url);
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 1, stream: false }),
  }).catch(() => null);
  if (!res) throw new Error(`Nothing is answering at ${base}.`);
  if (res.status === 401 || res.status === 403) throw new Error(key ? "The server rejected the API key." : "The server needs an API key.");
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error?.message || json?.detail || `The model answered ${res.status}.`);
  }
}

async function chat(messages, cfg) {
  const base = trim(cfg.url);
  const body = { model: cfg.model, messages, temperature: 0.2, stream: false, response_format: { type: "json_object" } };
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: headers(cfg.key), body: JSON.stringify(body) });
    } catch {
      throw new Error(`Nothing is answering at ${base}. Start your model server and try again.`);
    }
    const json = await res.json().catch(() => null);
    if (res.ok) return json?.choices?.[0]?.message?.content || "";
    if (res.status === 401 || res.status === 403) throw new Error("The model server rejected the API key. Check it in Settings.");
    const msg = json?.error?.message || json?.error || `The model server answered ${res.status}.`;
    // Some servers don't know response_format; ask again without it.
    if (attempt === 0 && res.status === 400 && /response_format|json/i.test(String(msg))) { delete body.response_format; continue; }
    if (res.status === 404 && /model/i.test(String(msg))) throw new Error(`The server doesn't have the model "${cfg.model}". Pick one in Settings.`);
    throw new Error(String(msg));
  }
}

const setSummary = (id, value) => updateRecording(id, { summary: value });

/** Summarise a transcribed recording. Long transcripts go part by part, then merge. */
export async function summarizeRecording(id) {
  const { llm: cfg } = await getSettings();
  const rec = await getRecording(id);
  const segments = rec.transcript?.state === "done" ? rec.transcript.segments : null;
  if (!segments) throw new Error("Transcribe the recording first.");
  await setSummary(id, { state: "working", at: Date.now() });
  try {
    const chunks = chunkSegments(segments, 12000);
    let result;
    if (chunks.length === 1) {
      result = parseSummary(await chat(messagesFor(segments), cfg));
    } else {
      const notes = [];
      for (let i = 0; i < chunks.length; i++) {
        await setSummary(id, { state: "working", part: i + 1, parts: chunks.length, at: Date.now() });
        notes.push(parseSummary(await chat(sectionMessages(chunks[i], i + 1, chunks.length), cfg)));
      }
      result = parseSummary(await chat(mergeMessages(notes), cfg));
    }
    const fresh = await getRecording(id);
    // The model names the recording unless you already did.
    const patch = { summary: { state: "done", ...result, model: cfg.model, at: Date.now() } };
    if (result.title && !fresh.titleEdited) patch.title = result.title;
    return updateRecording(id, patch);
  } catch (e) {
    return setSummary(id, { state: "error", error: e.message });
  }
}
