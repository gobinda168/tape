// The recording engine. Runs in the offscreen document (tab + camera recordings)
// or in the recorder tab (window / screen recordings). Both are extension pages,
// so the finished file goes straight into the shared IndexedDB.

import "./fix-webm-duration.js";
import { QUALITY } from "./settings.js";

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
  constructor({ video, audio = [], playback = false, quality = "1080", onEnded }) {
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
      }
    }

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
    });
    this.mime = this.rec.mimeType || this.mime;
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.segmentStart = performance.now();
    this.state = "recording";
  }

  pause() {
    if (this.state !== "recording") return;
    this.rec.pause();
    this.elapsedBefore += performance.now() - this.segmentStart;
    this.state = "paused";
  }

  resume() {
    if (this.state !== "paused") return;
    this.rec.resume();
    this.segmentStart = performance.now();
    this.state = "recording";
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
    await this.#finish();
    this.chunks = [];
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
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.state = "released";
  }
}
