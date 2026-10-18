// User settings live in chrome.storage.local so the popup, the worker and the library agree.

export const DEFAULTS = {
  mode: "screen-cam", // "screen-cam" | "screen" | "cam"
  source: "tab", // "tab" | "desktop"
  cameraId: "",
  micId: "",
  micOn: true,
  countdown: true,
  quality: "1080", // "720" | "1080" | "1440"
  bubbleSize: "m", // "s" | "m" | "l"
  saveTo: "downloads", // "downloads" | "folder"
  folderName: "",
  server: { url: "", token: "" },
  autoUpload: false,
  // Google Drive: the user's own OAuth client; email is the connected account.
  drive: { clientId: "", email: "", name: "", autoUpload: false, anyoneWithLink: false },
  // Transcription by a model on this computer (OpenAI-style /v1/audio/transcriptions).
  transcribe: { url: "", model: "", key: "", auto: false },
  // Title and summary by a local LLM (OpenAI-style /v1/chat/completions, e.g. Ollama).
  llm: { provider: "", url: "", model: "", key: "", auto: true }, // provider: ollama | lmstudio | nvidia | custom
  skippedSetup: false,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return {
    ...DEFAULTS,
    ...(settings || {}),
    server: { ...DEFAULTS.server, ...(settings?.server || {}) },
    drive: { ...DEFAULTS.drive, ...(settings?.drive || {}) },
    transcribe: { ...DEFAULTS.transcribe, ...(settings?.transcribe || {}) },
    llm: { ...DEFAULTS.llm, ...(settings?.llm || {}) },
  };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const QUALITY = {
  "720": { width: 1280, height: 720 },
  "1080": { width: 1920, height: 1080 },
  "1440": { width: 2560, height: 1440 },
};
