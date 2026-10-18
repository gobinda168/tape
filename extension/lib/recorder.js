// The recording engine. Runs in the offscreen document (tab + camera recordings)
// or in the recorder tab (window / screen recordings). Both are extension pages,
// so the finished file goes straight into the shared IndexedDB.

import "./fix-webm-duration.js";
import { QUALITY } from "./settings.js";
import { takeWatch } from "./level.js";

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1,opus",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickMime() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

const BITRATE = { "720": 2_500_000, "1080": 5_000_000, "1440": 8_000_000 };

export async function getMic(micId) {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: micId ? { ...base, deviceId: { exact: micId } } : base });
  } catch (e) {
    if (micId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ audio: base });
    }
    throw e;
  }
}

export async function getCamera(cameraId, quality = "1080") {
  const { width, height } = QUALITY[quality] || QUALITY["1080"];
  const v = { width: { ideal: Math.min(width, 1920) }, height: { ideal: Math.min(height, 1080) }, frameRate: { ideal: 30 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: cameraId ? { ...v, deviceId: { exact: cameraId } } : v });
  } catch (e) {
    if (cameraId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ video: v });
    }
    throw e;
  }
}

export function getTabStream(streamId, quality = "1080") {
  const { width, height } = QUALITY[quality] || QUALITY["1080"];
  return navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: 30,
      },
    },
  });
}

export function getDesktopStream(quality = "1080") {
  const { width, height } = QUALITY[quality] || QUALITY["1080"];
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
    audio: true,
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    monitorTypeSurfaces: "include",
  });
}

export class TapeRecorder {
  /**
   * @param {object} o
   * @param {MediaStream} o.video   stream whose first video track is recorded
   * @param {MediaStream[]} o.audio streams whose audio tracks are mixed in
   * @param {boolean} o.playback    play the captured tab's audio back (tab capture mutes the tab)
   */
  constructor({ video, audio = [], mic = null, playback = false, quality = "1080", onEnded, onMicSilent, onChunk }) {
    this.streams = [video, ...audio].filter(Boolean);
    this.videoTrack = video.getVideoTracks()[0];
    this.quality = quality;
    this.mime = pickMime();
    this.chunks = [];
    this.elapsedBefore = 0;
    this.segmentStart = 0;
    this.state = "ready";

    const audioStreams = audio.filter((s) => s && s.getAudioTracks().length);
    if (audioStreams.length) {
      this.ctx = new AudioContext();
      this.dest = this.ctx.createMediaStreamDestination();
      for (const s of audioStreams) {
        const src = this.ctx.createMediaStreamSource(s);
        src.connect(this.dest);
        if (playback && s === video) src.connect(this.ctx.destination);
        // Listen to the mic on its own, so a muted mic shows up while recording, not after.
        if (s === mic) {
          this.micAnalyser = this.ctx.createAnalyser();
          this.micAnalyser.fftSize = 1024;
          src.connect(this.micAnalyser);
        }
      }
    }
    this.onMicSilent = onMicSilent;
    this.onChunk = onChunk;
    this.heard = false;

    this.videoTrack.addEventListener("ended", () => {
      if (this.state === "recording" || this.state === "paused") onEnded?.();
    });
  }

  get elapsed() {
    const live = this.state === "recording" ? performance.now() - this.segmentStart : 0;
    return this.elapsedBefore + live;
  }

  begin() {
    const tracks = [this.videoTrack, ...(this.dest ? this.dest.stream.getAudioTracks() : [])];
    this.chunks = [];
    this.elapsedBefore = 0;
    this.rec = new MediaRecorder(new MediaStream(tracks), {
      mimeType: this.mime || undefined,
      videoBitsPerSecond: BITRATE[this.quality] || BITRATE["1080"],
      audioBitsPerSecond: 128_000,
      // MP4 only emits data at keyframes, and a still screen may not make one for minutes.
      // A keyframe every 2 s keeps chunks flowing to disk, so a crash loses seconds, not the take.
      videoKeyFrameIntervalDuration: 2000,
    });
    this.mime = this.rec.mimeType || this.mime;
    this.rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.chunks.push(e.data);
      this.onChunk?.(e.data, this.chunks.length - 1, Math.round(this.elapsed));
    };
    this.rec.start(1000);
    this.segmentStart = performance.now();
    this.state = "recording";
    this.#watchMic();
  }

  #watchMic() {
    clearInterval(this.micTimer);
    if (!this.micAnalyser) return;
    const buf = new Float32Array(this.micAnalyser.fftSize);
    // A fresh watch per segment: the quiet of a pause doesn't count against the mic.
    const watch = takeWatch({ after: 3000, onChange: (silent) => this.onMicSilent?.(silent) });
    this.micTimer = setInterval(() => {
      this.micAnalyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      watch.feed(peak, performance.now());
      if (watch.heard) this.heard = true;
    }, 250);
  }

  #unwatchMic() {
    clearInterval(this.micTimer);
    this.onMicSilent?.(false);
  }

  /** null when there was no mic; false when the mic never carried a sound (it was muted). */
  get micHeard() {
    return this.micAnalyser ? this.heard : null;
  }

  pause() {
    if (this.state !== "recording") return;
    this.rec.pause();
    this.elapsedBefore += performance.now() - this.segmentStart;
    this.state = "paused";
    this.#unwatchMic();
  }

  resume() {
    if (this.state !== "paused") return;
    this.rec.resume();
    this.segmentStart = performance.now();
    this.state = "recording";
    this.#watchMic();
  }

  #finish() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === "inactive") return resolve();
      this.rec.onstop = () => resolve();
      this.rec.stop();
    });
  }

  /** Throw away what was recorded so far; streams stay open for another take. */
  async discardTake() {
    if (this.state === "recording") this.elapsedBefore += performance.now() - this.segmentStart;
    this.#unwatchMic();
    await this.#finish();
    this.chunks = [];
    this.heard = false;
    this.state = "ready";
  }

  async stop() {
    const durationMs = Math.round(this.elapsed);
    await this.#finish();
    this.state = "stopped";
    const { width, height } = this.videoTrack.getSettings();
    let blob = new Blob(this.chunks, { type: (this.mime || "video/webm").split(";")[0] });
    if (blob.type === "video/webm" && globalThis.ysFixWebmDuration) {
      blob = await globalThis.ysFixWebmDuration(blob, durationMs, { logger: false });
    }
    this.release();
    return { blob, durationMs, mime: blob.type, width: width || 0, height: height || 0 };
  }

  release() {
    clearInterval(this.micTimer);
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.state = "released";
  }
}
