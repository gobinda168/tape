import { recoverTakes, listRecordings, getRecording, getBlob, getThumb, putThumb, updateRecording, deleteRecording } from "./lib/db.js";
import { getSettings, setSettings } from "./lib/settings.js";
import { saveToDisk, showInFolder, getFolder, chooseFolder, regrantFolder, download, testServer, uploadToServer, renameOnServer, deleteOnServer } from "./lib/save.js";
import { clock, bytes, when, fileName, icon, esc } from "./lib/format.js";

const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view");
const urls = new Map(); // object URLs we created, revoked on re-render
let settings = await getSettings();
let currentId = null;

$("#settingsLink").innerHTML = icon("gear-six");

// ---------- small helpers ----------

function objectUrl(key, blob) {
  if (!blob) return "";
  if (urls.has(key)) return urls.get(key);
  const u = URL.createObjectURL(blob);
  urls.set(key, u);
  return u;
}

let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  t.classList.remove("in");
  void t.offsetWidth;
  t.classList.add("in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function banner(text) {
  const b = $("#banner");
  if (!text) return (b.hidden = true);
  b.innerHTML = `${icon("warning")}<span>${esc(text)}</span><button type="button" aria-label="Dismiss">${icon("x")}</button>`;
  b.hidden = false;
  b.querySelector("button").onclick = () => (b.hidden = true);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied");
  } catch {
    toast("Could not copy. Select the link and copy it.");
  }
}

function parseHash() {
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  return { parts: (path || "/").split("/").filter(Boolean), query: new URLSearchParams(query || "") };
}

async function paintWhere() {
  const el = $("#where");
  if (settings.saveTo === "folder") {
    const f = await getFolder();
    el.innerHTML = `${icon("folder-simple")}<span>${f ? `Saving to ${esc(f.name)}` : "Choose a folder"}</span>`;
  } else {
    el.innerHTML = `${icon("folder-simple")}<span>Saving to Downloads/Tape</span>`;
  }
}

// ---------- router ----------

async function route() {
  const { parts, query } = parseHash();
  if (query.get("error")) banner(query.get("error"));
  settings = await getSettings();
  paintWhere();
  if (parts[0] === "settings") return renderSettings();
  if (parts[0] === "setup") return renderSetup();
  return renderLibrary(parts[0] === "r" ? parts[1] : null, query.get("fresh") === "1");
}

window.addEventListener("hashchange", route);

// ---------- library ----------

const savingNow = new Set(); // ids with a disk write running in this page

async function diskSave(id, blob) {
  savingNow.add(id);
  try { return await saveToDisk(id, blob); } finally { savingNow.delete(id); }
}

async function renderLibrary(id, fresh) {
  // Pick up any take that was cut off (crash, closed recorder) before listing.
  const { rec: live } = await chrome.storage.session.get("rec").catch(() => ({}));
  await recoverTakes(live && live.status !== "idle" ? live.takeId : undefined).catch(() => {});
  const list = await listRecordings();
  const rec = (id && list.find((r) => r.id === id)) || list[0];
  currentId = rec?.id || null;

  if (!rec) {
    view.innerHTML = `
      <div class="library empty">
        <section class="empty-state">
          <div class="empty-orb" aria-hidden="true"><span class="lens"></span></div>
          <h1 class="empty-title">Your recordings will live here</h1>
          <p class="empty-copy">Click Tape in the toolbar, or press <span class="keys"><kbd>Alt</kbd><kbd>Shift</kbd><kbd>R</kbd></span> on any page. Every take is saved to this computer the moment you stop.</p>
        </section>
      </div>`;
    return;
  }

  const blob = await getBlob(rec.id);
  const thumb = await getThumb(rec.id);
  const others = list;

  view.innerHTML = `
    <div class="library">
      <section class="stage" aria-label="Selected recording">
        <article class="print big ${fresh ? "developing" : ""}" id="print">
          <div class="glow" aria-hidden="true">${thumb ? `<img src="${objectUrl("t:" + rec.id, thumb)}" alt="">` : ""}</div>
          <div class="photo" id="player" tabindex="-1"></div>
          <div class="margin">
            <label class="sr-only" for="title">Title</label>
            <input class="title" id="title" value="${esc(rec.title)}" maxlength="120" spellcheck="false" autocomplete="off">
            <p class="meta tnum">
              <span>${esc(when(rec.createdAt))}</span>
              <span>${clock(rec.durationMs)}</span>
              <span>${bytes(rec.size)}</span>
              ${rec.width ? `<span>${rec.width}×${rec.height}</span>` : ""}
            </p>
            ${rec.noSound ? `<p class="no-sound">${icon("microphone-slash")}<span>The mic was on but never picked up a sound. If you spoke, it was probably muted.</span></p>` : ""}
          </div>
        </article>

        <section class="lives" aria-label="Where this recording is saved" id="lives"></section>

        <div class="actions">
          <button type="button" class="btn" id="dl">${icon("download-simple")}Download a copy</button>
          <button type="button" class="btn quiet" id="del">${icon("trash")}Delete</button>
          <div class="confirm" id="confirm" hidden>
            <span>Delete from the Tape library?</span>
            ${rec.saves?.server?.state === "saved" ? `<label class="check"><input type="checkbox" id="delServer" checked> Also remove the share link</label>` : ""}
            <button type="button" class="btn danger" id="delYes">Delete</button>
            <button type="button" class="btn quiet" id="delNo">Keep</button>
            <p class="fine">Files already saved on your computer stay where they are.</p>
          </div>
        </div>
      </section>

      <aside class="sheet" aria-label="All recordings">
        <h2>Recordings <span class="count tnum">${list.length}</span></h2>
        <ul class="grid">
          ${others.map((r, i) => sheetItem(r, r.id === rec.id, fresh && r.id === rec.id, i)).join("")}
        </ul>
      </aside>
    </div>`;

  // Thumbnails for the contact sheet.
  for (const r of others) {
    getThumb(r.id).then((t) => {
      const img = view.querySelector(`[data-thumb="${r.id}"]`);
      if (t && img) { img.src = objectUrl("t:" + r.id, t); img.hidden = false; }
    });
  }

  if (blob) {
    TapePlayer.mount($("#player"), {
      src: objectUrl("v:" + rec.id, blob),
      poster: thumb ? objectUrl("t:" + rec.id, thumb) : "",
      durationMs: rec.durationMs,
    });
  }
  paintLives(rec);
  wireLibrary(rec, blob);

  if (!thumb && blob) makeThumb(rec, blob);
  if (fresh) {
    history.replaceState(null, "", `#/r/${rec.id}`);
    develop(rec, blob);
  }
}

function sheetItem(r, active, developing = false, i = 0) {
  const disk = r.saves?.disk?.state;
  const server = r.saves?.server?.state;
  const marks = [
    disk === "saved" ? `<span class="tag tone-orange" title="Saved on this computer">${icon("hard-drives")}</span>` : "",
    server === "saved" ? `<span class="tag tone-blue" title="Has a share link">${icon("link")}</span>` : "",
    disk === "error" || server === "error" ? `<span class="tag tone-red" title="A save failed">${icon("warning")}</span>` : "",
    r.noSound ? `<span class="tag tone-red" title="No sound: the mic was muted">${icon("microphone-slash")}</span>` : "",
  ].join("");
  return `
    <li style="--i:${i}">
      <a class="print small${active ? " active" : ""}${developing ? " developing" : ""}" href="#/r/${r.id}" ${active ? 'aria-current="true"' : ""}>
        <span class="photo"><img data-thumb="${r.id}" alt="" hidden><span class="dur tnum">${clock(r.durationMs)}</span></span>
        <span class="margin">
          <span class="t">${esc(r.title)}</span>
          <span class="m"><span class="tnum">${esc(when(r.createdAt))}</span><span class="tags">${marks}</span></span>
        </span>
      </a>
    </li>`;
}

function row({ tone, ico, name, detail, state, actions = "" }) {
  return `
    <div class="row is-${state}">
      <span class="chip tone-${tone}">${icon(ico)}</span>
      <div class="row-text">
        <strong>${name}</strong>
        <span class="detail">${detail}</span>
      </div>
      <div class="row-act">${actions}</div>
    </div>`;
}

async function paintLives(rec) {
  const el = $("#lives");
  if (!el) return;
  const d = rec.saves?.disk;
  const s = rec.saves?.server;
  let html = "";

  if (d?.state === "saving" && savingNow.has(rec.id)) {
    html += row({ tone: "yellow", ico: "hard-drives", name: "This computer", detail: "Saving", state: "saving" });
  } else if (!d || d.state === "saving") {
    // Never saved, or a save that was cut off (the page closed mid-write).
    html += row({
      tone: "idle", ico: "hard-drives", name: "Not on this computer yet", detail: esc(fileName(rec)), state: "idle",
      actions: `<button type="button" class="btn primary" data-act="retry-disk">${icon("download-simple")}Save to this computer</button>`,
    });
  } else if (d.state === "saved") {
    const where = d.where === "folder" ? `${esc(d.folder)}/${esc(d.fileName)}` : esc(d.path || `Downloads/Tape/${d.fileName}`);
    html += row({
      tone: "orange", ico: "hard-drives", name: "Saved on this computer", detail: `<span class="path" title="${where}">${where}</span>`, state: "saved",
      actions: d.where === "downloads" ? `<button type="button" class="btn" data-act="show">${icon("folder-simple")}Show in folder</button>` : "",
    });
  } else if (d.state === "needs-access") {
    html += row({
      tone: "yellow", ico: "hard-drives", name: "This computer", detail: `Tape needs permission to write to ${esc(d.folder)}.`, state: "needs",
      actions: `<button type="button" class="btn primary" data-act="regrant">Allow and save</button>`,
    });
  } else {
    html += row({
      tone: "red", ico: "warning", name: "Not saved to this computer", detail: `<span class="struck">${esc(fileName(rec))}</span> <span class="why">${esc(d.error || "")}</span>`, state: "error",
      actions: `<button type="button" class="btn" data-act="retry-disk">${icon("arrows-clockwise")}Retry</button>`,
    });
  }

  const configured = settings.server.url && settings.server.token;
  if (s?.state === "saved") {
    html += row({
      tone: "blue", ico: "link", name: "Share link", detail: `<a class="path link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ""))}</a>`, state: "saved",
      actions: `<button type="button" class="btn primary" data-act="copy">${icon("copy")}Copy link</button>`,
    });
  } else if (s?.state === "saving") {
    html += row({ tone: "yellow", ico: "cloud-arrow-up", name: "Share link", detail: `Uploading to your server <span class="tnum" id="upPct">${Math.round((s.progress || 0) * 100)}%</span>`, state: "saving" });
  } else if (s?.state === "error") {
    html += row({
      tone: "red", ico: "warning", name: "Upload failed", detail: `<span class="why">${esc(s.error)}</span>`, state: "error",
      actions: `<button type="button" class="btn" data-act="upload">${icon("arrows-clockwise")}Retry</button>`,
    });
  } else if (configured) {
    html += row({
      tone: "idle", ico: "link", name: "Share link", detail: `Upload to ${esc(settings.server.url.replace(/^https?:\/\//, ""))} and copy a link.`, state: "idle",
      actions: `<button type="button" class="btn primary" data-act="upload">${icon("cloud-arrow-up")}Get link</button>`,
    });
  } else {
    html += row({
      tone: "idle", ico: "link", name: "Share links", detail: `Run your own Tape server to get links you can send. <a class="link" href="#/settings">Set it up</a>`, state: "idle",
    });
  }
  el.innerHTML = html;
}

function wireLibrary(rec, blob) {
  const title = $("#title");
  const commit = async () => {
    const v = title.value.trim() || rec.title;
    title.value = v;
    if (v === rec.title) return;
    rec = await updateRecording(rec.id, { title: v });
    renameOnServer(rec);
    const t = view.querySelector(`.print.small.active .t`);
    if (t) t.textContent = v;
  };
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
    if (e.key === "Escape") { title.value = rec.title; title.blur(); }
  });
  title.addEventListener("blur", commit);

  $("#lives").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const fresh = await getRecording(rec.id);
    switch (b.dataset.act) {
      case "show": return showInFolder(fresh.saves.disk);
      case "copy": return copy(fresh.saves.server.url);
      case "retry-disk": await diskSave(rec.id, blob); break;
      case "regrant":
        if (await regrantFolder()) await diskSave(rec.id, blob);
        else toast("Tape still cannot write to that folder");
        break;
      case "upload": await makeThumb(rec, blob); await upload(rec.id, blob); break;
    }
    paintLives(await getRecording(rec.id));
  });

  $("#dl").onclick = () => download(blob, fileName(rec)).then(() => toast("Copy downloaded")).catch((e) => toast(e.message));
  $("#del").onclick = () => { $("#confirm").hidden = false; $("#delYes").focus(); };
  $("#delNo").onclick = () => ($("#confirm").hidden = true);
  $("#delYes").onclick = async () => {
    const fresh = await getRecording(rec.id);
    if ($("#delServer")?.checked) await deleteOnServer(fresh);
    await deleteRecording(rec.id);
    for (const k of ["v:" + rec.id, "t:" + rec.id]) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
    location.hash = "#/";
    toast("Recording deleted");
  };
}

async function upload(id, blob) {
  const res = await uploadToServer(id, blob, (p) => {
    const pct = $("#upPct");
    if (pct) pct.textContent = Math.round(p * 100) + "%";
  }).catch((e) => ({ saves: { server: { state: "error", error: e.message } } }));
  if (res?.saves?.server?.state === "saved") await copy(res.saves.server.url);
  return res;
}

// The signature move: a fresh print develops while it saves.
async function develop(rec, blob) {
  const print = $("#print");
  const started = performance.now();
  if (!rec.saves?.disk) { savingNow.add(rec.id); paintLives({ ...rec, saves: { disk: { state: "saving" } } }); }
  let saved = rec.saves?.disk ? rec : await diskSave(rec.id, blob);
  if (currentId === rec.id) paintLives(saved);
  // Give the image time to come up even when the write is instant.
  const wait = Math.max(0, 1400 - (performance.now() - started));
  setTimeout(() => {
    print?.classList.remove("developing");
    view.querySelector(`.print.small[href="#/r/${rec.id}"]`)?.classList.remove("developing");
  }, wait);

  if (saved?.saves?.disk?.state === "saved") toast(`Saved to ${saved.saves.disk.where === "folder" ? saved.saves.disk.folder : "Downloads/Tape"}`);
  if (settings.autoUpload && settings.server.url && settings.server.token) {
    await makeThumb(rec, blob); // the share page uses it as the poster
    const t = setInterval(async () => currentId === rec.id && paintLives(await getRecording(rec.id)), 400);
    await upload(rec.id, blob);
    clearInterval(t);
    if (currentId === rec.id) paintLives(await getRecording(rec.id));
  }
  refreshSheetItem(rec.id);
}

async function refreshSheetItem(id) {
  const r = await getRecording(id);
  const li = view.querySelector(`.print.small[href="#/r/${id}"]`)?.parentElement;
  if (r && li) {
    li.outerHTML = sheetItem(r, id === currentId, id === currentId && !!$("#print.developing"));
    getThumb(id).then((t) => {
      const img = view.querySelector(`[data-thumb="${id}"]`);
      if (t && img) { img.src = objectUrl("t:" + id, t); img.hidden = false; }
    });
  }
}

const thumbJobs = new Map();
function makeThumb(rec, blob) {
  if (!thumbJobs.has(rec.id)) thumbJobs.set(rec.id, new Promise((done) => drawThumb(rec, blob, done)));
  return thumbJobs.get(rec.id);
}

function drawThumb(rec, blob, done) {
  const v = document.createElement("video");
  setTimeout(done, 4000); // never hold up a save on a frame that will not decode
  v.muted = true;
  v.preload = "auto";
  v.src = objectUrl("v:" + rec.id, blob);
  const at = Math.min(1, (rec.durationMs || 0) / 2000);
  v.addEventListener("loadeddata", () => { v.currentTime = at; }, { once: true });
  v.addEventListener("seeked", () => {
    const w = 640;
    const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    c.toBlob(async (t) => {
      if (!t) return done();
      await putThumb(rec.id, t);
      done();
      const img = view.querySelector(`[data-thumb="${rec.id}"]`);
      if (img) { img.src = objectUrl("t:" + rec.id, t); img.hidden = false; }
      const big = view.querySelector("#print video");
      if (big && currentId === rec.id && !big.poster) big.poster = objectUrl("t:" + rec.id, t);
      const glow = view.querySelector("#print .glow");
      if (glow && currentId === rec.id && !glow.firstChild) glow.innerHTML = `<img src="${objectUrl("t:" + rec.id, t)}" alt="">`;
    }, "image/jpeg", 0.82);
  }, { once: true });
}

// ---------- settings ----------

function sw(id, on, label, hint = "") {
  return `
    <label class="switch-row" for="${id}">
      <span><strong>${label}</strong>${hint ? `<span class="hint">${hint}</span>` : ""}</span>
      <input type="checkbox" role="switch" id="${id}" ${on ? "checked" : ""}>
    </label>`;
}

async function renderSettings() {
  const folder = await getFolder();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  view.innerHTML = `
    <div class="sheet-page">
      <a class="back" href="#/">${icon("caret-down")}Library</a>
      <h1>Settings</h1>

      <section class="group">
        <h2>Saving</h2>
        <p class="lede">Every recording is saved to this computer as soon as you stop. The library keeps a copy for playback.</p>
        <div class="choice" role="radiogroup" aria-label="Save location">
          <label class="opt">
            <input type="radio" name="saveTo" value="downloads" ${settings.saveTo === "downloads" ? "checked" : ""}>
            <span><strong>Downloads/Tape</strong><span class="hint">No prompts. Files land in Chrome's download folder.</span></span>
          </label>
          <label class="opt">
            <input type="radio" name="saveTo" value="folder" ${settings.saveTo === "folder" ? "checked" : ""}>
            <span>
              <strong>A folder you choose</strong>
              <span class="hint">${folder ? `Current: ${esc(folder.name)}${folder.permission === "granted" ? "" : ". Chrome will ask for access again after a restart."}` : "Pick any folder, for example Movies/Tape."}</span>
            </span>
            <button type="button" class="btn" id="pickFolder">${icon("folder-simple")}${folder ? "Change" : "Choose"} folder</button>
          </label>
        </div>
      </section>

      <section class="group">
        <h2>Recording</h2>
        ${sw("countdown", settings.countdown, "Count down from 3", "Gives you a moment before the recording starts.")}
        <div class="field-row">
          <label for="quality"><strong>Video quality</strong><span class="hint">Higher quality makes bigger files.</span></label>
          <select id="quality">
            <option value="720" ${settings.quality === "720" ? "selected" : ""}>720p</option>
            <option value="1080" ${settings.quality === "1080" ? "selected" : ""}>1080p</option>
            <option value="1440" ${settings.quality === "1440" ? "selected" : ""}>1440p</option>
          </select>
        </div>
        <div class="field-row">
          <label for="bubble"><strong>Camera bubble size</strong><span class="hint">You can also change it while recording.</span></label>
          <select id="bubble">
            <option value="s" ${settings.bubbleSize === "s" ? "selected" : ""}>Small</option>
            <option value="m" ${settings.bubbleSize === "m" ? "selected" : ""}>Medium</option>
            <option value="l" ${settings.bubbleSize === "l" ? "selected" : ""}>Large</option>
          </select>
        </div>
        <div class="field-row">
          <span><strong>Keyboard shortcuts</strong><span class="hint"><span class="keys"><kbd>Alt</kbd><kbd>Shift</kbd><kbd>R</kbd></span> start or stop, <span class="keys"><kbd>Alt</kbd><kbd>Shift</kbd><kbd>P</kbd></span> pause</span></span>
          <button type="button" class="btn" id="shortcuts">${icon("keyboard")}Change</button>
        </div>
      </section>

      <section class="group">
        <h2>Share server <span class="opt-tag">Optional</span></h2>
        <p class="lede">Run <code>tape-server</code> on your own machine or a box you own to get links you can send. Uploads go only there.</p>
        <form id="serverForm" class="stack" autocomplete="off">
          <div class="field">
            <label for="srvUrl">Server address</label>
            <input id="srvUrl" type="url" inputmode="url" placeholder="http://127.0.0.1:8787" value="${esc(settings.server.url)}">
          </div>
          <div class="field">
            <label for="srvToken">Owner token</label>
            <input id="srvToken" type="password" value="${esc(settings.server.token)}" spellcheck="false">
            <span class="hint">Printed by tape-server when it starts, or set with TAPE_TOKEN.</span>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn primary">Save and test</button>
            <span class="result" id="srvResult" role="status"></span>
          </div>
        </form>
        ${sw("autoUpload", settings.autoUpload, "Upload every new recording", "The link is copied as soon as the upload finishes.")}
      </section>

      <section class="group">
        <h2>Library</h2>
        <p class="lede">${est ? `Library copies use ${bytes(est.usage)} of browser storage.` : "Library copies live in this browser's storage."} Deleting from the library never deletes files on your computer.</p>
      </section>
    </div>`;

  const save = async (patch) => { settings = await setSettings(patch); paintWhere(); };
  view.querySelectorAll('input[name="saveTo"]').forEach((r) =>
    r.addEventListener("change", async () => {
      if (r.value === "folder" && !(await getFolder())) {
        try { await chooseFolder(); } catch { view.querySelector('input[value="downloads"]').checked = true; return; }
      }
      await save({ saveTo: r.value });
      renderSettings();
    })
  );
  $("#pickFolder").onclick = async (e) => {
    e.preventDefault();
    try { await chooseFolder(); await save({ saveTo: "folder" }); renderSettings(); toast("Folder saved"); } catch {}
  };
  $("#countdown").onchange = (e) => save({ countdown: e.target.checked });
  $("#autoUpload").onchange = (e) => save({ autoUpload: e.target.checked });
  $("#quality").onchange = (e) => save({ quality: e.target.value });
  $("#bubble").onchange = (e) => save({ bubbleSize: e.target.value });
  $("#shortcuts").onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  $("#serverForm").onsubmit = async (e) => {
    e.preventDefault();
    const url = $("#srvUrl").value.trim().replace(/\/+$/, "");
    const token = $("#srvToken").value.trim();
    await save({ server: { url, token } });
    const out = $("#srvResult");
    if (!url || !token) { out.className = "result"; out.textContent = url || token ? "Add both the address and the token." : "Share server removed."; return; }
    out.className = "result";
    out.textContent = "Testing";
    try {
      const me = await testServer(url, token);
      out.className = "result ok";
      out.innerHTML = `${icon("check")}Connected to ${esc(me.name || "tape-server")} ${esc(me.version || "")}`;
    } catch (err) {
      out.className = "result bad";
      out.textContent = err.message === "Failed to fetch" ? `Could not reach ${url}. Is tape-server running?` : err.message;
    }
  };
}

// ---------- setup ----------

async function renderSetup() {
  const perm = async (name) => { try { return (await navigator.permissions.query({ name })).state; } catch { return "prompt"; } };
  const cam = await perm("camera");
  const mic = await perm("microphone");
  const folder = await getFolder();
  const mediaDone = cam === "granted" && mic === "granted";
  view.innerHTML = `
    <div class="sheet-page setup">
      <h1>Set up Tape</h1>
      <p class="lede">Three things and you are recording. Nothing leaves this computer unless you send it to a server you run.</p>

      <section class="step ${mediaDone ? "done" : ""}">
        <span class="chip ${mediaDone ? "tone-green" : "tone-idle"}">${icon(mediaDone ? "check" : "video-camera")}</span>
        <div>
          <h2>Camera and microphone</h2>
          <p>${mediaDone ? "Allowed. Tape only turns them on while you record." : cam === "denied" || mic === "denied" ? "Blocked. Click the camera icon at the right end of the address bar, allow both, then reload this page." : "Chrome asks once for each."}</p>
          <div class="cam-check" ${mediaDone ? "" : "hidden"}><video id="setupCam" autoplay muted playsinline></video></div>
        </div>
        ${mediaDone ? "" : `<button type="button" class="btn primary" id="allowMedia">Allow</button>`}
      </section>

      <section class="step done">
        <span class="chip tone-orange">${icon("hard-drives")}</span>
        <div>
          <h2>Where recordings go</h2>
          <p>${settings.saveTo === "folder" && folder ? `Into ${esc(folder.name)}.` : "Into Downloads/Tape. You can pick another folder."}</p>
        </div>
        <button type="button" class="btn" id="setupFolder">${icon("folder-simple")}Choose folder</button>
      </section>

      <section class="step">
        <span class="chip tone-idle">${icon("keyboard")}</span>
        <div>
          <h2>Pin Tape and record</h2>
          <p>Click the puzzle piece in Chrome's toolbar and pin Tape. Then press <span class="keys"><kbd>Alt</kbd><kbd>Shift</kbd><kbd>R</kbd></span> on any page.</p>
        </div>
      </section>

      <div class="form-actions"><a class="btn primary" href="#/">Done</a></div>
    </div>`;

  if (mediaDone) {
    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320 } }).then((s) => {
      const v = $("#setupCam");
      if (!v) return s.getTracks().forEach((t) => t.stop());
      v.srcObject = s;
      window.addEventListener("hashchange", () => s.getTracks().forEach((t) => t.stop()), { once: true });
    }).catch(() => {});
  }
  $("#allowMedia")?.addEventListener("click", async () => {
    // Ask for each on its own: a Mac with no camera (a Mac mini) would fail a
    // combined request and leave the microphone unasked too.
    const failed = [];
    for (const [kind, name] of [["audio", "microphone"], ["video", "camera"]]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ [kind]: true });
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        failed.push(e.name === "NotAllowedError" ? `Chrome blocked the ${name}` : `No ${name} found`);
      }
    }
    if (failed.length) toast(failed.join(" · "));
    renderSetup();
  });
  $("#setupFolder").onclick = async () => {
    try { await chooseFolder(); settings = await setSettings({ saveTo: "folder" }); paintWhere(); renderSetup(); } catch {}
  };
}

// Settings changed in another tab or the popup.
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.settings) { settings = { ...settings, ...c.settings.newValue }; paintWhere(); }
});

route();
