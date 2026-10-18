// Tape in-page overlay: countdown, recording bar and camera bubble.
// Runs on every page (manifest) and is also injected when a recording starts, so it
// guards against running twice. Everything lives in a closed shadow root.

(() => {
  if (window.top !== window) return;
  // The newest copy always takes over. A plain "already ran" flag would let a copy
  // orphaned by an extension reload (its listeners dead) block the fresh one forever.
  const me = {};
  window.__tapeOverlay = me;
  const current = () => window.__tapeOverlay === me;
  document.querySelectorAll("tape-overlay").forEach((el) => el.remove());

  const ext = (p) => chrome.runtime.getURL(p);
  const I = (n) => `<span class="icon" aria-hidden="true">${globalThis.TapeIcons?.[n] || ""}</span>`;
  const SIZES = { s: 132, m: 184, l: 264 };
  const LIVE = ["countdown", "recording", "paused", "saving"];

  let state = { status: "idle" };
  let root = null;
  let els = {};
  let tick = null;
  let myTabId = null;

  // Fonts must be registered on the document to reach the shadow root.
  try {
    const add = (family, file) => {
      const f = new FontFace(family, `url(${ext(file)})`, { weight: "100 900" });
      f.load().then(() => document.fonts.add(f)).catch(() => {});
    };
    add("Tape Geist", "fonts/Geist-Variable.woff2");
    add("Tape Geist Mono", "fonts/GeistMono-Variable.woff2");
  } catch {}

  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  const send = (type, extra) => chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});

  function mount() {
    if (root) return;
    const hostEl = document.createElement("tape-overlay");
    hostEl.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    const shadow = hostEl.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <link rel="stylesheet" href="${ext("styles/content.css")}">
      <div class="count" part="count" hidden><span class="num">3</span></div>
      <div class="bubble" hidden>
        <iframe title="Your camera" allow="camera; microphone; autoplay" tabindex="-1"></iframe>
        <div class="sizes" role="group" aria-label="Camera size">
          <button type="button" data-size="s" aria-label="Small camera">S</button>
          <button type="button" data-size="m" aria-label="Medium camera">M</button>
          <button type="button" data-size="l" aria-label="Large camera">L</button>
        </div>
      </div>
      <div class="bar" role="toolbar" aria-label="Tape recording controls">
        <span class="grip" aria-hidden="true">${I("dots-six-vertical")}</span>
        <button type="button" class="stop" data-cmd="stop" aria-label="Stop and save">${I("stop-fill")}<span class="time tnum">0:00</span></button>
        <button type="button" class="ctl" data-cmd="toggle-pause" aria-label="Pause">${I("pause")}</button>
        <button type="button" class="ctl" data-cmd="restart" aria-label="Restart recording">${I("arrow-counter-clockwise")}</button>
        <button type="button" class="ctl" data-cmd="cancel" aria-label="Cancel and delete">${I("trash")}</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="ctl" data-cmd="toggle-cam" aria-label="Hide camera">${I("video-camera")}</button>
      </div>
      <div class="confirm" role="alertdialog" aria-label="Delete this recording?" hidden>
        <p>Delete this recording?</p>
        <button type="button" class="danger" data-confirm="yes">Delete</button>
        <button type="button" class="plain" data-confirm="no">Keep recording</button>
      </div>`;
    (document.body || document.documentElement).appendChild(hostEl);
    root = hostEl;
    els = {
      count: shadow.querySelector(".count"),
      num: shadow.querySelector(".num"),
      bubble: shadow.querySelector(".bubble"),
      frame: shadow.querySelector("iframe"),
      bar: shadow.querySelector(".bar"),
      time: shadow.querySelector(".time"),
      pause: shadow.querySelector('[data-cmd="toggle-pause"]'),
      cam: shadow.querySelector('[data-cmd="toggle-cam"]'),
      confirm: shadow.querySelector(".confirm"),
      shadow,
    };

    els.bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-cmd]");
      if (!b) return;
      if (b.dataset.cmd === "cancel") {
        const r = els.bar.getBoundingClientRect();
        els.confirm.style.left = r.left + "px";
        els.confirm.style.bottom = innerHeight - r.top + 10 + "px";
        els.confirm.hidden = false;
        els.confirm.querySelector(".danger").focus();
        return;
      }
      send(b.dataset.cmd);
    });
    els.confirm.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-confirm]");
      if (!b) return;
      els.confirm.hidden = true;
      if (b.dataset.confirm === "yes") send("cancel");
    });
    els.bubble.querySelector(".sizes").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-size]");
      if (b) send("bubble-size", { size: b.dataset.size });
    });

    draggable(els.bar, "bar", { left: 24, bottom: 24 });
    draggable(els.bubble, "bubble", { left: 24, bottom: 88 });
  }

  function unmount() {
    clearInterval(tick);
    tick = null;
    root?.remove();
    root = null;
    els = {};
  }

  // Positions are stored per kind so the bar and bubble stay where the user put them.
  function draggable(el, key, fallback) {
    let pos = fallback;
    try { pos = JSON.parse(sessionStorage.getItem("tape-pos-" + key)) || fallback; } catch {}
    place(el, pos);
    let start = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      start = { x: e.clientX, y: e.clientY, rect: el.getBoundingClientRect() };
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const r = start.rect;
      const left = Math.min(Math.max(8, r.left + e.clientX - start.x), innerWidth - r.width - 8);
      const top = Math.min(Math.max(8, r.top + e.clientY - start.y), innerHeight - r.height - 8);
      pos = { left, bottom: innerHeight - top - r.height };
      place(el, pos);
    });
    const end = () => {
      if (!start) return;
      start = null;
      el.classList.remove("dragging");
      try { sessionStorage.setItem("tape-pos-" + key, JSON.stringify(pos)); } catch {}
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function place(el, { left, bottom }) {
    el.style.left = left + "px";
    el.style.bottom = Math.max(8, bottom) + "px";
  }

  // In a tab recording the overlay belongs to the captured tab only; in a screen
  // recording it follows whichever tab is in front.
  function belongsHere(s) {
    if (!LIVE.includes(s.status)) return false;
    if (s.source === "tab") return s.captureTabId === myTabId;
    return document.visibilityState === "visible";
  }

  function render() {
    if (!current()) return unmount();
    const s = state;
    if (!belongsHere(s)) return unmount();
    mount();

    const counting = s.status === "countdown";
    els.count.hidden = !counting;
    els.bar.hidden = counting;
    els.bar.classList.toggle("paused", s.status === "paused");
    els.bar.classList.toggle("saving", s.status === "saving");
    els.pause.innerHTML = s.status === "paused" ? I("play") : I("pause");
    els.pause.setAttribute("aria-label", s.status === "paused" ? "Resume" : "Pause");

    const wantsCam = s.mode !== "screen";
    els.cam.hidden = !wantsCam || s.mode === "cam";
    els.shadow.querySelector(".sep").hidden = els.cam.hidden;
    els.cam.innerHTML = s.camOn ? I("video-camera") : I("video-camera-slash");
    els.cam.setAttribute("aria-label", s.camOn ? "Hide camera" : "Show camera");

    const showBubble = wantsCam && s.camOn && s.source !== "cam";
    const showBig = s.mode === "cam";
    const size = showBig ? 264 : SIZES[s.bubbleSize] || SIZES.m;
    els.bubble.hidden = !(showBubble || showBig);
    els.bubble.style.setProperty("--size", size + "px");
    for (const b of els.bubble.querySelectorAll("[data-size]")) b.setAttribute("aria-pressed", String(b.dataset.size === s.bubbleSize));
    if (!els.bubble.hidden) {
      const src = ext(`camera.html?device=${encodeURIComponent(s.cameraId || "")}`);
      if (els.frame.dataset.src !== src) {
        els.frame.dataset.src = src;
        els.frame.src = src;
      }
    } else if (els.frame.dataset.src) {
      els.frame.removeAttribute("src");
      delete els.frame.dataset.src;
    }

    clearInterval(tick);
    const paint = () => {
      if (state.status === "countdown") {
        const left = Math.max(1, Math.ceil((state.countdownEnd - Date.now()) / 1000));
        if (els.num.textContent !== String(left)) {
          els.num.textContent = left;
          els.num.classList.remove("pop");
          void els.num.offsetWidth;
          els.num.classList.add("pop");
        }
      } else {
        const ms = state.elapsedBefore + (state.status === "recording" ? Date.now() - state.segmentStart : 0);
        els.time.textContent = state.status === "saving" ? "Saving" : clock(ms);
      }
    };
    paint();
    tick = setInterval(paint, 250);
  }

  chrome.storage.session.onChanged.addListener((changes) => {
    if (!changes.rec) return;
    state = changes.rec.newValue || { status: "idle" };
    render();
  });
  document.addEventListener("visibilitychange", render);

  Promise.all([
    chrome.storage.session.get("rec").catch(() => ({})),
    chrome.runtime.sendMessage({ type: "whoami" }).catch(() => null),
  ]).then(([{ rec }, me]) => {
    myTabId = me?.tabId ?? null;
    state = rec || { status: "idle" };
    render();
  });
})();
