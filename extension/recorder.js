import { createHost, describe } from "./lib/host.js";
import { getDesktopStream } from "./lib/recorder.js";
import { clock, icon } from "./lib/format.js";

const $ = (id) => document.getElementById(id);
const host = createHost("recorder-tab");
let opts = null;
let live = false;

$("choose").innerHTML = `${icon("monitor")}Choose window or screen`;
$("stop").innerHTML = `${icon("stop-fill")}Stop and save`;

async function choose(auto = false) {
  $("error").hidden = true;
  try {
    const displayStream = await getDesktopStream(opts.quality);
    await host.prepare({ opts, displayStream });
    live = true;
    $("pick").hidden = true;
    $("live").hidden = false;
    await chrome.runtime.sendMessage({ type: "host-ready" });
  } catch (e) {
    host.release();
    if (auto) return; // Chrome wanted a click first; the button is waiting.
    $("error").textContent = e.name === "NotAllowedError" ? "Nothing was shared. Choose a window or screen to start." : describe(e);
    $("error").hidden = false;
  }
}

$("choose").addEventListener("click", () => choose());
$("cancel").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "host-failed", error: "cancelled" });
});
$("stop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "stop" }));
$("pause").addEventListener("click", () => chrome.runtime.sendMessage({ type: "toggle-pause" }));

function paint(s) {
  if (!s || !live) return;
  const paused = s.status === "paused";
  document.body.classList.toggle("paused", paused);
  document.body.classList.toggle("recording", s.status === "recording");
  $("label").textContent = { countdown: "Starting", recording: "Recording", paused: "Paused", saving: "Saving" }[s.status] || "Recording";
  $("pause").innerHTML = paused ? `${icon("play")}Resume` : `${icon("pause")}Pause`;
  const elapsed = s.elapsedBefore + (s.status === "recording" ? Date.now() - s.segmentStart : 0);
  $("timer").textContent = clock(elapsed);
  document.title = paused ? "Tape: paused" : `Tape: ${clock(elapsed)}`;
}

let state = null;
chrome.storage.session.onChanged.addListener((c) => c.rec && paint((state = c.rec.newValue)));
setInterval(() => paint(state), 500);

window.addEventListener("beforeunload", (e) => {
  if (live && state && ["recording", "paused", "countdown"].includes(state.status)) e.preventDefault();
});

const hello = await chrome.runtime.sendMessage({ type: "host-hello" });
if (!hello?.ok) {
  $("pick").innerHTML = "<h1>No recording waiting</h1><p>Start a recording from the Tape button in the toolbar.</p>";
} else {
  opts = hello.opts;
  state = hello.opts;
  // Chrome may show the picker straight away; if it wants a click first, the button is there.
  choose(true);
}
