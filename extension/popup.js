import { getSettings, setSettings } from "./lib/settings.js";
import { clock, icon } from "./lib/format.js";

const $ = (id) => document.getElementById(id);
const send = (type, extra) => chrome.runtime.sendMessage({ type, ...extra });

const MODES = {
  "screen-cam": ["user-focus", "Screen + cam"],
  screen: ["monitor", "Screen"],
  cam: ["video-camera", "Camera"],
};
const SOURCES = { tab: ["browser", "This tab"], desktop: ["app-window", "Window or screen"] };

let settings = await getSettings();
let perms = { camera: "prompt", microphone: "prompt" };
let previewStream = null;
let micStream = null;
let meterRaf = 0;

$("library").innerHTML = icon("film-strip");
$("settings").innerHTML = icon("gear-six");
$("allow").innerHTML = `${icon("video-camera")}Allow access`;
$("start").innerHTML = `${icon("record-fill")}Start recording`;
$("stop").innerHTML = `${icon("stop-fill")}Stop and save`;
$("restart").innerHTML = icon("arrow-counter-clockwise");
$("cancel").innerHTML = icon("trash");
for (const b of $("mode").children) b.innerHTML = `${icon(MODES[b.dataset.v][0])}<span>${MODES[b.dataset.v][1]}</span>`;
for (const b of $("source").children) b.innerHTML = `${icon(SOURCES[b.dataset.v][0])}<span>${SOURCES[b.dataset.v][1]}</span>`;

const openApp = (hash = "") => chrome.tabs.create({ url: chrome.runtime.getURL("app.html" + hash) }).then(() => window.close());
$("library").onclick = () => openApp("#/");
$("settings").onclick = () => openApp("#/settings");
$("allow").onclick = () => openApp("#/setup");
$("skip").onclick = async () => {
  settings = await setSettings({ skippedSetup: true, mode: "screen", micOn: false });
  show("idle");
};

async function readPerms() {
  for (const name of ["camera", "microphone"]) {
    try { perms[name] = (await navigator.permissions.query({ name })).state; } catch { perms[name] = "prompt"; }
  }
}

function show(view) {
  for (const id of ["setup", "idle", "live"]) $(id).hidden = id !== view;
  if (view === "idle") paintIdle();
  else stopMedia();
}

function radio(group, value) {
  for (const b of $(group).children) b.setAttribute("aria-checked", String(b.dataset.v === value));
}

async function fillDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const fill = (sel, kind, chosen, granted) => {
    const list = devices.filter((d) => d.kind === kind && d.deviceId);
    sel.innerHTML = "";
    if (!granted || !list.length) {
      sel.add(new Option(granted ? "None found" : "Not allowed yet", ""));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    for (const d of list) sel.add(new Option(d.label || (kind === "videoinput" ? "Camera" : "Microphone"), d.deviceId));
    sel.value = list.some((d) => d.deviceId === chosen) ? chosen : list[0].deviceId;
  };
  fill($("camera"), "videoinput", settings.cameraId, perms.camera === "granted");
  fill($("mic"), "audioinput", settings.micId, perms.microphone === "granted");
}

async function paintIdle() {
  radio("mode", settings.mode);
  radio("source", settings.source);
  $("source").hidden = settings.mode === "cam";
  $("camRow").hidden = settings.mode === "screen";
  $("micToggle").innerHTML = icon(settings.micOn ? "microphone" : "microphone-slash");
  $("micToggle").setAttribute("aria-pressed", String(settings.micOn));
  $("micToggle").setAttribute("aria-label", settings.micOn ? "Microphone on" : "Microphone off");
  $("mic").disabled = !settings.micOn || perms.microphone !== "granted";
  await fillDevices();
  if (!settings.micOn) $("mic").disabled = true;
  const needsCam = settings.mode !== "screen" && perms.camera !== "granted";
  $("start").disabled = false;
  $("start").innerHTML = needsCam ? `${icon("video-camera")}Allow camera to record` : `${icon("record-fill")}Start recording`;
  startMedia();
}

async function startMedia() {
  stopMedia();
  if (settings.mode !== "screen" && perms.camera === "granted") {
    const id = $("camera").value;
    navigator.mediaDevices
      .getUserMedia({ video: id ? { deviceId: { exact: id }, width: 320, height: 320 } : { width: 320, height: 320 } })
      .then((s) => { previewStream = s; $("preview").srcObject = s; })
      .catch(() => {});
  }
  if (settings.micOn && perms.microphone === "granted") {
    const id = $("mic").value;
    navigator.mediaDevices
      .getUserMedia({ audio: id ? { deviceId: { exact: id } } : true })
      .then((s) => {
        micStream = s;
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          $("micToggle").style.setProperty("--lvl", Math.min(1, peak / 48).toFixed(2));
          meterRaf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => {});
  } else {
    $("micToggle").style.setProperty("--lvl", 0);
  }
}

function stopMedia() {
  cancelAnimationFrame(meterRaf);
  for (const s of [previewStream, micStream]) s?.getTracks().forEach((t) => t.stop());
  previewStream = micStream = null;
}

for (const [group, key] of [["mode", "mode"], ["source", "source"]]) {
  $(group).addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    settings = await setSettings({ [key]: b.dataset.v });
    paintIdle();
  });
  // Arrow keys move within a radio group.
  $(group).addEventListener("keydown", async (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const items = [...$(group).children].filter((b) => !b.hidden);
    const i = items.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    settings = await setSettings({ [key]: next.dataset.v });
    await paintIdle();
    next.focus();
  });
}

$("camera").onchange = async () => { settings = await setSettings({ cameraId: $("camera").value }); startMedia(); };
$("mic").onchange = async () => { settings = await setSettings({ micId: $("mic").value }); startMedia(); };
$("micToggle").onclick = async () => { settings = await setSettings({ micOn: !settings.micOn }); paintIdle(); };

$("start").onclick = async () => {
  if (settings.mode !== "screen" && perms.camera !== "granted") return openApp("#/setup");
  $("error").hidden = true;
  $("start").disabled = true;
  $("start").innerHTML = "Starting";
  stopMedia(); // free the camera for the recorder
  const res = await send("start", {
    opts: { mode: settings.mode, source: settings.source, cameraId: $("camera").value, micId: $("mic").value, micOn: settings.micOn },
  }).catch((e) => ({ ok: false, error: e.message }));
  if (res?.ok) return window.close();
  $("error").textContent = res?.error || "Could not start recording.";
  $("error").hidden = false;
  paintIdle();
};

$("stop").onclick = () => send("stop").then(() => window.close());
$("pause").onclick = () => send("toggle-pause");
$("restart").onclick = () => send("restart").then(() => window.close());
$("cancel").onclick = () => send("cancel").then(() => window.close());

let rec = (await chrome.storage.session.get("rec")).rec || { status: "idle" };
let liveTick = 0;

function paintLive() {
  const paused = rec.status === "paused";
  document.body.classList.toggle("paused", paused);
  document.body.classList.toggle("recording", rec.status === "recording");
  $("liveLabel").textContent = { preparing: "Getting ready", countdown: "Starting", recording: "Recording", paused: "Paused", saving: "Saving" }[rec.status] || "";
  $("pause").innerHTML = icon(paused ? "play" : "pause");
  $("pause").setAttribute("aria-label", paused ? "Resume" : "Pause");
  const ms = (rec.elapsedBefore || 0) + (rec.status === "recording" ? Date.now() - rec.segmentStart : 0);
  $("timer").textContent = clock(ms);
}

async function route() {
  clearInterval(liveTick);
  if (rec.status !== "idle") {
    show("live");
    paintLive();
    liveTick = setInterval(paintLive, 250);
    return;
  }
  await readPerms();
  const none = perms.camera !== "granted" && perms.microphone !== "granted";
  show(none && !settings.skippedSetup ? "setup" : "idle");
}

chrome.storage.session.onChanged.addListener((c) => {
  if (!c.rec) return;
  const was = rec.status;
  rec = c.rec.newValue || { status: "idle" };
  if ((was === "idle") !== (rec.status === "idle")) route();
});

route();
