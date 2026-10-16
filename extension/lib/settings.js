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
  skippedSetup: false,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}), server: { ...DEFAULTS.server, ...(settings?.server || {}) } };
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
