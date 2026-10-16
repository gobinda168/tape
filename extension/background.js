// Tape service worker: owns the recording state machine.
//
//   idle -> preparing -> countdown -> recording <-> paused -> saving -> idle
//
// The recorder itself lives in an offscreen document (this tab, camera only) or in
// a recorder tab (window or screen; Chrome only shows that picker from a real tab).
// State is mirrored to chrome.storage.session so the popup and the in-page bar can
// render it, and so it survives the worker being suspended mid-recording.

import { getSettings } from "./lib/settings.js";

const IDLE = { status: "idle" };
const COUNTDOWN_MS = 3000;
const RECORDER_URL = "recorder.html";
const OFFSCREEN_URL = "offscreen.html";

chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setState(IDLE);
  if (reason === "install") chrome.tabs.create({ url: "app.html#/setup" });
});

chrome.runtime.onStartup.addListener(() => setState(IDLE));

async function getState() {
  const { rec } = await chrome.storage.session.get("rec");
  return rec || IDLE;
}

async function setState(next) {
  await chrome.storage.session.set({ rec: next });
  paintBadge(next);
  return next;
}

const patchState = async (patch) => setState({ ...(await getState()), ...patch });

function paintBadge(s) {
  const live = s.status === "recording" || s.status === "paused" || s.status === "countdown";
  chrome.action.setBadgeText({ text: live ? "REC" : s.status === "saving" ? "..." : "" });
  chrome.action.setBadgeBackgroundColor({ color: s.status === "paused" ? "#F2C230" : "#E5402F" });
  chrome.action.setBadgeTextColor?.({ color: s.status === "paused" ? "#17181A" : "#FFFFFF" });
  chrome.action.setTitle({
    title: { recording: "Tape: recording", paused: "Tape: paused", countdown: "Tape: starting", saving: "Tape: saving" }[s.status] || "Tape",
  });
}

// ---------- recorder hosts ----------

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Record the tab, camera and microphone while the user keeps browsing.",
  });
}

async function closeOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) await chrome.offscreen.closeDocument().catch(() => {});
}

async function host(cmd, extra = {}) {
  const s = await getState();
  const to = s.host === "tab" ? "recorder-tab" : "offscreen";
  try {
    return await chrome.runtime.sendMessage({ to, cmd, ...extra });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function injectOverlay(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/icons.js", "content.js"] });
  } catch {
    // chrome:// pages, the Web Store and similar refuse scripts. Recording still works.
  }
}

// ---------- state transitions ----------

async function start(opts) {
  const cur = await getState();
  if (cur.status !== "idle") return { ok: false, error: "A recording is already in progress." };

  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const mode = opts.mode || settings.mode;
  const source = mode === "cam" ? "cam" : opts.source || settings.source;
  const base = {
    status: "preparing",
    mode,
    source,
    camOn: mode !== "screen",
    cameraId: opts.cameraId ?? settings.cameraId,
    micId: opts.micId ?? settings.micId,
    micOn: opts.micOn ?? settings.micOn,
    quality: settings.quality,
    bubbleSize: settings.bubbleSize,
    countdown: settings.countdown,
    returnTabId: tab?.id ?? null,
    captureTabId: source === "tab" ? tab?.id ?? null : null,
    elapsedBefore: 0,
    segmentStart: 0,
    startedAt: 0,
  };

  if (source === "desktop") {
    // Chrome's screen picker needs a tab to sit in; the recorder tab is that tab.
    const recTab = await chrome.tabs.create({ url: RECORDER_URL, active: true, index: tab ? tab.index + 1 : undefined });
    await setState({ ...base, host: "tab", recorderTabId: recTab.id });
    return { ok: true, picking: true };
  }

  let streamId = null;
  if (source === "tab") {
    if (!tab || !/^(https?|file):/.test(tab.url || "")) {
      // Chrome cannot capture its own pages (chrome://, the Web Store).
      return { ok: false, error: "Chrome does not allow recording this page. Open a website, or record a window or your screen." };
    }
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    } catch (e) {
      return { ok: false, error: e.message || "Could not capture this tab." };
    }
  }

  await setState({ ...base, host: "offscreen" });
  await ensureOffscreen();
  const res = await host("prepare", { opts: base, streamId });
  if (!res?.ok) {
    await closeOffscreen();
    await setState(IDLE);
    return { ok: false, error: res?.error || "Could not start the recorder." };
  }
  await ready();
  return { ok: true };
}

// The host has its streams; show the countdown in the page, then roll.
async function ready() {
  const s = await getState();
  await injectOverlay(s.captureTabId || s.returnTabId);
  if (s.countdown) {
    await patchState({ status: "countdown", countdownEnd: Date.now() + COUNTDOWN_MS });
    setTimeout(begin, COUNTDOWN_MS);
  } else {
    await begin();
  }
}

async function begin() {
  const s = await getState();
  if (s.status !== "countdown" && s.status !== "preparing") return;
  const res = await host("begin");
  if (!res?.ok) return fail(res?.error || "The recorder did not start.");
  const now = Date.now();
  await patchState({ status: "recording", segmentStart: now, startedAt: s.startedAt || now });
}

async function pause() {
  const s = await getState();
  if (s.status !== "recording") return;
  await host("pause");
  await patchState({ status: "paused", elapsedBefore: s.elapsedBefore + (Date.now() - s.segmentStart) });
}

async function resume() {
  const s = await getState();
  if (s.status !== "paused") return;
  await host("resume");
  await patchState({ status: "recording", segmentStart: Date.now() });
}

async function restart() {
  const s = await getState();
  if (!["recording", "paused", "countdown"].includes(s.status)) return;
  await host("discard");
  await patchState({ status: "preparing", elapsedBefore: 0, segmentStart: 0, startedAt: 0 });
  await ready();
}

async function stop() {
  const s = await getState();
  if (!["recording", "paused", "countdown"].includes(s.status)) return;
  if (s.status === "countdown") return cancel();
  await patchState({ status: "saving" });
  const res = await host("stop", { startedAt: s.startedAt, meta: { mode: s.mode, source: s.source } });
  await teardown(s);
  await setState(IDLE);
  if (res?.ok && res.id) {
    await openLibrary(`#/r/${res.id}?fresh=1`);
  } else {
    await openLibrary(`#/?error=${encodeURIComponent(res?.error || "The recording could not be saved.")}`);
  }
}

async function cancel() {
  const s = await getState();
  if (s.status === "idle") return;
  await host("cancel");
  await teardown(s);
  await setState(IDLE);
}

async function fail(error) {
  const s = await getState();
  await host("cancel");
  await teardown(s);
  await setState(IDLE);
  await openLibrary(`#/?error=${encodeURIComponent(error)}`);
}

async function teardown(s) {
  if (s.host === "tab" && s.recorderTabId) {
    await chrome.tabs.remove(s.recorderTabId).catch(() => {});
  } else {
    await closeOffscreen();
  }
}

async function openLibrary(hash) {
  const url = chrome.runtime.getURL("app.html");
  const tabs = await chrome.tabs.query({ url: url + "*" });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { url: url + hash, active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: url + hash });
  }
}

// ---------- messages ----------

const handlers = {
  start: (m) => start(m.opts || {}),
  pause,
  resume,
  restart,
  stop,
  cancel,
  "toggle-pause": async () => ((await getState()).status === "paused" ? resume() : pause()),
  "toggle-cam": async () => patchState({ camOn: !(await getState()).camOn }),
  "bubble-size": (m) => patchState({ bubbleSize: m.size }),
  state: getState,
  whoami: (_m, sender) => ({ tabId: sender.tab?.id ?? null }),

  // From the recorder tab.
  "host-hello": async (m, sender) => {
    const s = await getState();
    if (s.host !== "tab" || sender.tab?.id !== s.recorderTabId) return { ok: false };
    return { ok: true, opts: s };
  },
  "host-ready": async () => {
    const s = await getState();
    if (s.returnTabId) {
      const t = await chrome.tabs.update(s.returnTabId, { active: true }).catch(() => null);
      if (t) await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
    await ready();
    return { ok: true };
  },
  "host-failed": async (m) => {
    const s = await getState();
    await teardown(s);
    await setState(IDLE);
    if (s.returnTabId) chrome.tabs.update(s.returnTabId, { active: true }).catch(() => {});
    return { ok: true, error: m.error };
  },
  // The user pressed Chrome's own "Stop sharing", or the camera went away.
  "host-ended": () => stop(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to) return false; // addressed to a recorder host, not to us
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg, sender))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  const s = await getState();
  if (command === "toggle-recording") {
    if (s.status === "idle") chrome.action.openPopup().catch(() => {});
    else if (s.status === "countdown") cancel();
    else stop();
  } else if (command === "toggle-pause") {
    handlers["toggle-pause"]();
  }
});

// Closing the recorder tab mid-recording ends the recording without a file.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (s.host === "tab" && s.recorderTabId === tabId && s.status !== "idle" && s.status !== "saving") {
    await setState(IDLE);
  }
});

// New pages in the captured tab (or any tab, for screen recordings) get the overlay
// through the manifest content script; nothing to do here.
