// Recorder host: answers the worker's commands for one recording session.
// Used by offscreen.js (this tab, camera only) and recorder.js (window or screen).

import { TapeRecorder, getMic, getCamera, getTabStream, getDesktopStream } from "./recorder.js";
import { addRecording, newId, beginTake, putChunk, endTake } from "./db.js";
import { defaultTitle } from "./format.js";

export function createHost(name) {
  let rec = null;
  let take = null; // { id, writes }: chunks go to IndexedDB as they arrive, in order

  async function prepare({ opts, streamId, displayStream }) {
    release();
    // The mic is on, so a take without it would be silent: stop here and say why.
    const mic = opts.micOn
      ? await getMic(opts.micId).catch((e) => {
          throw Object.assign(new Error(`${micProblem(e)} Allow it in Tape setup, or turn the microphone off to record without sound.`), { mic: true });
        })
      : null;
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
    take = opts.takeId ? { id: opts.takeId, opts, writes: Promise.resolve() } : null;
    rec = new TapeRecorder({
      video,
      audio,
      mic,
      playback,
      quality: opts.quality,
      onEnded: () => chrome.runtime.sendMessage({ type: "host-ended" }).catch(() => {}),
      onMicSilent: (silent) => chrome.runtime.sendMessage({ type: "mic-silent", silent }).catch(() => {}),
      onChunk: (blob, seq, durationMs) => {
        if (take) take.writes = take.writes.then(() => putChunk(take.id, seq, blob, durationMs)).catch(() => {});
      },
    });
    return { ok: true, mic: !!mic };
  }

  async function stop({ startedAt, meta }) {
    if (!rec) return { ok: false, error: "Nothing was recording." };
    const micHeard = rec.micHeard;
    const out = await rec.stop();
    rec = null;
    const done = take;
    take = null;
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
        noSound: micHeard === false, // the mic was on and never carried a sound
        saves: {},
      },
      out.blob
    );
    // Saved for real: the crash copy can go (after its last chunk has landed).
    if (done) await done.writes.then(() => endTake(done.id)).catch(() => {});
    return { ok: true, id };
  }

  function release() {
    rec?.release();
    rec = null;
    dropTake();
  }

  function dropTake() {
    const t = take;
    take = null;
    if (t) t.writes.then(() => endTake(t.id)).catch(() => {});
  }

  function startTake() {
    if (!take) return;
    const { id, opts } = take;
    take.writes = take.writes.then(() =>
      beginTake({ id, createdAt: Date.now(), mime: rec.mime, mode: opts.mode, source: opts.source })
    ).catch(() => {});
  }

  const commands = {
    prepare,
    begin: () => (rec ? (rec.begin(), startTake(), { ok: true }) : { ok: false, error: "Recorder not ready." }),
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

function micProblem(e) {
  if (e.name === "NotAllowedError") return "Tape isn't allowed to use the microphone.";
  if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "No microphone was found.";
  if (e.name === "NotReadableError") return "Another app is using the microphone.";
  return "The microphone didn't start.";
}

export function describe(e) {
  if (!e) return "Unknown error.";
  if (e.name === "NotAllowedError") return "Permission was denied. Allow camera and microphone for Tape, then try again.";
  if (e.name === "NotFoundError") return "No camera or microphone was found.";
  if (e.name === "NotReadableError") return "Another app is using the camera or microphone.";
  return e.message || String(e);
}
