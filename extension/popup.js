import { getSettings, setSettings } from "./lib/settings.js";
import { clock, icon } from "./lib/format.js";
import { measure, silenceWatch, spectrumBars, ease } from "./lib/level.js";

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
let audioCtx = null;
let mediaGen = 0; // bumps on every restart so a slow getUserMedia can't revive old media

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
$("allowCamera").onclick = $("allowMic").onclick = () => openApp("#/setup");
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
    for (const d of list) sel.add(new Option(cleanLabel(d.label) || (kind === "videoinput" ? "Camera" : "Microphone"), d.deviceId));
    if (list.length) sel.value = list.some((d) => d.deviceId === chosen) ? chosen : list[0].deviceId;
    return granted ? (list.length ? "ok" : "none") : "blocked";
  };
  devState.camera = fill($("camera"), "videoinput", settings.cameraId, perms.camera === "granted");
  devState.mic = fill($("mic"), "audioinput", settings.micId, perms.microphone === "granted");

  // Camera: the viewfinder says what is wrong when there is no picture.
  const cam = devState.camera;
  $("camera").parentElement.hidden = cam !== "ok";
  $("camEmpty").hidden = cam === "ok";
  $("allowCamera").hidden = cam !== "blocked";
  $("camEmptyIcon").innerHTML = icon(cam === "blocked" ? "video-camera-slash" : "video-camera");
  $("camEmptyText").innerHTML = cam === "blocked"
    ? "<strong>Camera not allowed</strong>Tape uses it only while you record."
    : "<strong>No camera found</strong>Plug one in, or bring your iPhone close, locked, to use it as a camera.";

  // Microphone: a picker when allowed, a button when not.
  const mic = devState.mic;
  $("mic").parentElement.hidden = mic === "blocked";
  $("allowMic").hidden = mic !== "blocked";
  $("mic").disabled = !settings.micOn || mic !== "ok";
}

// "Yeti Stereo Microphone (046d:0ab7)": the USB id means nothing to people.
const cleanLabel = (l) => l.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "");

const devState = { camera: "none", mic: "none" };

async function paintIdle() {
  radio("mode", settings.mode);
  radio("source", settings.source);
  $("source").hidden = settings.mode === "cam";
  $("camRow").hidden = settings.mode === "screen";
  $("micToggle").innerHTML = icon(settings.micOn ? "microphone" : "microphone-slash");
  $("micToggle").setAttribute("aria-pressed", String(settings.micOn));
  $("micToggle").setAttribute("aria-label", settings.micOn ? "Microphone on" : "Microphone off");
  await fillDevices();
  const wantsCam = settings.mode !== "screen";
  const noCam = wantsCam && devState.camera === "none";
  $("start").disabled = noCam;
  $("start").innerHTML = noCam ? "No camera to record"
    : wantsCam && devState.camera === "blocked" ? `${icon("video-camera")}Allow camera to record`
    : `${icon("record-fill")}Start recording`;
  startMedia();
}

async function startMedia() {
  stopMedia();
  const gen = ++mediaGen;
  const vf = $("camRow");
  vf.classList.remove("live");
  if (settings.mode !== "screen" && devState.camera === "ok") {
    const id = $("camera").value;
    navigator.mediaDevices
      .getUserMedia({ video: id ? { deviceId: { exact: id }, width: 640, height: 360 } : { width: 640, height: 360 } })
      .then((s) => {
        if (gen !== mediaGen) return s.getTracks().forEach((t) => t.stop());
        previewStream = s;
        $("preview").srcObject = s;
        $("preview").onloadeddata = () => vf.classList.add("live");
      })
      .catch(() => {});
  }

  if (!settings.micOn || devState.mic !== "ok") {
    paintMic(devState.mic === "blocked" ? "blocked" : devState.mic === "none" ? "none" : "off");
    drawWave([], "off");
    return;
  }
  paintMic("listening");
  const id = $("mic").value;
  // Raw input: noise suppression would hide the difference between a quiet room and a muted mic.
  const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  navigator.mediaDevices
    .getUserMedia({ audio: id ? { ...raw, deviceId: { exact: id } } : raw })
    .then((s) => {
      if (gen !== mediaGen) return s.getTracks().forEach((t) => t.stop());
      micStream = s;
      audioCtx = new AudioContext();
      const an = audioCtx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.55;
      audioCtx.createMediaStreamSource(s).connect(an);
      const wave = new Float32Array(an.fftSize);
      const spectrum = new Float32Array(an.frequencyBinCount);
      const watch = silenceWatch({ after: 1500 });
      let bars = [];
      let shown = "listening";
      const loop = (now) => {
        meterRaf = requestAnimationFrame(loop);
        an.getFloatTimeDomainData(wave);
        an.getFloatFrequencyData(spectrum);
        const { peak, level } = measure(wave);
        const silent = watch.feed(peak, now);
        const target = spectrumBars(spectrum, { bars: halfBars(), sampleRate: audioCtx.sampleRate, fftSize: an.fftSize });
        bars = target.map((v, i) => ease(bars[i] ?? 0, silent ? 0 : v));
        const state = silent ? "silent" : level > 0.02 || shown === "live" ? "live" : "listening";
        if (state !== shown) paintMic((shown = state));
        drawWave(bars, state, now);
      };
      meterRaf = requestAnimationFrame(loop);
    })
    .catch((e) => paintMic(e.name === "NotAllowedError" ? "blocked" : "failed"));
}

const MIC_STATUS = {
  listening: ["microphone", "Listening"],
  live: ["check", "Mic is working"],
  off: ["microphone-slash", "Mic off"],
  none: ["warning", "No microphone found"],
  blocked: ["microphone-slash", "Mic not allowed"],
  failed: ["warning", "Mic didn't start. Another app may be using it."],
  silent: ["warning", "<strong>No sound from this mic.</strong> Check its mute button, or pick another mic."],
};

function paintMic(state) {
  const [ic, text] = MIC_STATUS[state];
  $("micStatus").innerHTML = `${icon(ic)}<span>${text}</span>`;
  $("micStatus").className = "mic-status" + (state === "live" ? " ok" : "");
  $("meter").classList.toggle("silent", state === "silent");
}

// Voice bars mirrored from the centre: low voices in the middle, higher sounds toward the
// edges. Ink white, per the design: the level is not a state colour. Red only when silent.
const BAR = 3;
const GAP = 4;
const halfBars = () => Math.max(4, Math.ceil(Math.floor(($("wave").clientWidth || 280) / (BAR + GAP)) / 2));

function drawWave(vals, state, now = performance.now()) {
  const c = $("wave");
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const half = halfBars();
  const step = BAR + GAP;
  const cx = w / 2;
  const live = state === "live" || state === "listening";
  const ink = g.createLinearGradient(0, 0, 0, h);
  ink.addColorStop(0, "rgb(243 244 246 / 0.55)");
  ink.addColorStop(0.5, "rgb(255 255 255 / 1)");
  ink.addColorStop(1, "rgb(243 244 246 / 0.55)");
  g.fillStyle = state === "silent" ? "rgb(242 65 47 / 0.7)" : live ? ink : "rgb(255 255 255 / 0.14)";
  g.shadowColor = live ? "rgb(255 255 255 / 0.35)" : "transparent";
  g.shadowBlur = live ? 10 : 0;
  for (let k = -(half - 1); k <= half - 1; k++) {
    const d = Math.abs(k);
    const taper = 1 - (d / half) ** 2 * 0.45;
    let v = vals[d] ?? 0;
    // A slow ripple keeps a quiet, working mic visibly alive.
    if (live) v = Math.max(v, 0.07 + 0.05 * Math.sin(now / 320 - d * 0.55));
    const bh = Math.max(BAR, v * taper * (h - 4));
    g.beginPath();
    g.roundRect(cx + k * step - BAR / 2, (h - bh) / 2, BAR, bh, BAR / 2);
    g.fill();
  }
}

function stopMedia() {
  mediaGen++;
  cancelAnimationFrame(meterRaf);
  for (const s of [previewStream, micStream]) s?.getTracks().forEach((t) => t.stop());
  previewStream = micStream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
}

// A camera or mic plugged in (or an iPhone coming into range) shows up straight away.
navigator.mediaDevices.addEventListener("devicechange", () => {
  if (!$("idle").hidden) paintIdle();
});

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
  if (settings.mode !== "screen" && devState.camera === "blocked") return openApp("#/setup");
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
