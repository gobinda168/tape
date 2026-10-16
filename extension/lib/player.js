// Tape player: a camera-body control strip over a <video>. Plain script so the
// extension library and tape-server's share page (server/web/assets/player.js,
// a copy of this file) can both load it.
(() => {
  // Phosphor Icons (MIT).
  const ICONS = {
    "play": "<svg viewBox=\"0 0 256 256\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z\"/></svg>",
    "pause": "<svg viewBox=\"0 0 256 256\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z\"/></svg>",
    "sound": "<svg viewBox=\"0 0 256 256\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM32,96H72v64H32ZM144,207.64,88,164.09V91.91l56-43.55Zm54-106.08a40,40,0,0,1,0,52.88,8,8,0,0,1-12-10.58,24,24,0,0,0,0-31.72,8,8,0,0,1,12-10.58ZM248,128a79.9,79.9,0,0,1-20.37,53.34,8,8,0,0,1-11.92-10.67,64,64,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67A79.83,79.83,0,0,1,248,128Z\"/></svg>",
    "mute": "<svg viewBox=\"0 0 256 256\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M53.92,34.62A8,8,0,1,0,42.08,45.38L73.55,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V175.09l42.08,46.29a8,8,0,1,0,11.84-10.76ZM32,96H72v64H32ZM144,207.64,88,164.09V95.89l56,61.6Zm42-63.77a24,24,0,0,0,0-31.72,8,8,0,1,1,12-10.57,40,40,0,0,1,0,52.88,8,8,0,0,1-12-10.59Zm-80.16-76a8,8,0,0,1,1.4-11.23l39.85-31A8,8,0,0,1,160,32v74.83a8,8,0,0,1-16,0V48.36l-26.94,21A8,8,0,0,1,105.84,67.91ZM248,128a79.9,79.9,0,0,1-20.37,53.34,8,8,0,0,1-11.92-10.67,64,64,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67A79.83,79.83,0,0,1,248,128Z\"/></svg>",
    "full": "<svg viewBox=\"0 0 256 256\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z\"/></svg>"
  };

  const clock = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };

  /** Mount into `box` (position: relative). Returns the <video>. */
  function mount(box, { src, type, poster, durationMs }) {
    box.classList.add("tp");
    box.innerHTML = `
      <video playsinline preload="metadata"></video>
      <button type="button" class="tp-big" aria-label="Play">${ICONS.play}</button>
      <div class="tp-bar" role="group" aria-label="Video controls">
        <button type="button" class="tp-btn tp-play" aria-label="Play">${ICONS.play}</button>
        <span class="tp-time"><span class="tp-cur">0:00</span><span class="tp-sep">/</span><span class="tp-dur">0:00</span></span>
        <input class="tp-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
        <button type="button" class="tp-btn tp-mute" aria-label="Mute">${ICONS.sound}</button>
        <button type="button" class="tp-btn tp-full" aria-label="Full screen">${ICONS.full}</button>
      </div>`;
    const v = box.querySelector("video");
    const q = (c) => box.querySelector(c);
    if (type) {
      const s = document.createElement("source");
      s.src = src; s.type = type; v.append(s);
    } else v.src = src;
    if (poster) v.poster = poster;

    const total = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (durationMs || 0) / 1000);
    const paint = () => {
      const t = total();
      q(".tp-cur").textContent = clock(v.currentTime);
      q(".tp-dur").textContent = clock(t);
      const p = t ? v.currentTime / t : 0;
      if (!scrubbing) q(".tp-scrub").value = Math.round(p * 1000);
      q(".tp-scrub").style.setProperty("--p", p * 100 + "%");
      const playing = !v.paused && !v.ended;
      box.classList.toggle("tp-playing", playing);
      for (const b of [q(".tp-play"), q(".tp-big")]) {
        b.innerHTML = playing ? ICONS.pause : ICONS.play;
        b.setAttribute("aria-label", playing ? "Pause" : "Play");
      }
      q(".tp-mute").innerHTML = v.muted ? ICONS.mute : ICONS.sound;
      q(".tp-mute").setAttribute("aria-label", v.muted ? "Unmute" : "Mute");
    };
    let scrubbing = false;
    const toggle = () => (v.paused || v.ended ? v.play().catch(() => {}) : v.pause());
    q(".tp-play").onclick = toggle;
    q(".tp-big").onclick = toggle;
    v.addEventListener("click", toggle);
    q(".tp-mute").onclick = () => { v.muted = !v.muted; paint(); };
    q(".tp-full").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.());
    const scrub = q(".tp-scrub");
    scrub.addEventListener("input", () => { scrubbing = true; v.currentTime = (scrub.value / 1000) * total(); paint(); });
    scrub.addEventListener("change", () => { scrubbing = false; });
    for (const e of ["timeupdate", "play", "pause", "ended", "loadedmetadata", "durationchange", "volumechange"]) v.addEventListener(e, paint);
    box.addEventListener("keydown", (e) => {
      if (e.target.closest("input")) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      if (e.key === "ArrowRight") v.currentTime = Math.min(total(), v.currentTime + 5);
      if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 5);
    });
    paint();
    return v;
  }

  globalThis.TapePlayer = { mount };
})();
