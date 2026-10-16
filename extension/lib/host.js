// Recorder host: answers the worker's commands for one recording session.
// Used by offscreen.js (this tab, camera only) and recorder.js (window or screen).

import { TapeRecorder, getMic, getCamera, getTabStream, getDesktopStream } from "./recorder.js";
import { addRecording, newId } from "./db.js";
import { defaultTitle } from "./format.js";

export function createHost(name) {
  let rec = null;

  async function prepare({ opts, streamId, displayStream }) {
    release();
    const mic = opts.micOn ? await getMic(opts.micId).catch(() => null) : null;
    let video;
    let audio = [];
    let playback = false;
    if (opts.source === "cam") {
      video = await getCamera(opts.cameraId, opts.quality);
      audio = [mic];
    } else if (opts.source === "tab") {
      video = await getTabStream(streamId, opts.quality);
      audio = [video, mic];
      playback = true;
    } else {
      video = displayStream || (await getDesktopStream(opts.quality));
      audio = [video, mic];
    }
    rec = new TapeRecorder({
      video,
      audio,
      playback,
      quality: opts.quality,
      onEnded: () => chrome.runtime.sendMessage({ type: "host-ended" }).catch(() => {}),
    });
    return { ok: true, mic: !!mic };
  }

  async function stop({ startedAt, meta }) {
    if (!rec) return { ok: false, error: "Nothing was recording." };
    const out = await rec.stop();
    rec = null;
    if (!out.blob.size) return { ok: false, error: "The recording came out empty." };
    const createdAt = startedAt || Date.now();
    const id = newId();
    await addRecording(
      {
        id,
        title: defaultTitle(createdAt),
        createdAt,
        durationMs: out.durationMs,
        mime: out.mime,
        size: out.blob.size,
        width: out.width,
        height: out.height,
        mode: meta?.mode,
        source: meta?.source,
        saves: {},
      },
      out.blob
    );
    return { ok: true, id };
  }

  function release() {
    rec?.release();
    rec = null;
  }

  const commands = {
    prepare,
    begin: () => (rec ? (rec.begin(), { ok: true }) : { ok: false, error: "Recorder not ready." }),
    pause: () => (rec?.pause(), { ok: true }),
    resume: () => (rec?.resume(), { ok: true }),
    discard: async () => (await rec?.discardTake(), { ok: true }),
    stop,
    cancel: () => (release(), { ok: true }),
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.to !== name) return false;
    const fn = commands[msg.cmd];
    if (!fn) return false;
    Promise.resolve()
      .then(() => fn(msg))
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: describe(e) }));
    return true;
  });

  return { prepare, release, get recorder() { return rec; } };
}

export function describe(e) {
  if (!e) return "Unknown error.";
  if (e.name === "NotAllowedError") return "Permission was denied. Allow camera and microphone for Tape, then try again.";
  if (e.name === "NotFoundError") return "No camera or microphone was found.";
  if (e.name === "NotReadableError") return "Another app is using the camera or microphone.";
  return e.message || String(e);
}
