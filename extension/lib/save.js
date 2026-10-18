// Where a recording ends up: a file on this computer (Downloads/Tape or a folder
// the user picked) and, optionally, the user's own Tape share server.

import { getSettings } from "./settings.js";
import { getRecording, updateRecording, kvGet, kvSet, getThumb } from "./db.js";
import { fileName } from "./format.js";

const setSave = (id, key, value) =>
  updateRecording(id, (r) => ({ ...r, saves: { ...(r.saves || {}), [key]: value } }));

// ---------- this computer ----------

export async function getFolder() {
  const handle = await kvGet("folder").catch(() => null);
  if (!handle) return null;
  let permission = "prompt";
  try { permission = await handle.queryPermission({ mode: "readwrite" }); } catch {}
  return { handle, name: handle.name, permission };
}

export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: "tape", mode: "readwrite", startIn: "videos" });
  await kvSet("folder", handle);
  return handle;
}

/** Ask for folder access again. Must run inside a click. */
export async function regrantFolder() {
  const f = await getFolder();
  if (!f) return false;
  return (await f.handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function saveToDisk(id, blob) {
  const rec = await getRecording(id);
  const settings = await getSettings();
  const name = fileName(rec);
  await setSave(id, "disk", { state: "saving" });
  try {
    if (settings.saveTo === "folder") {
      const f = await getFolder();
      if (!f) throw new Error("Choose a folder in Settings, or save to Downloads.");
      if (f.permission !== "granted") {
        return setSave(id, "disk", { state: "needs-access", where: "folder", folder: f.name });
      }
      const fh = await f.handle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return setSave(id, "disk", { state: "saved", where: "folder", folder: f.name, fileName: name, at: Date.now() });
    }
    const item = await download(blob, `Tape/${name}`);
    return setSave(id, "disk", {
      state: "saved",
      where: "downloads",
      downloadId: item.id,
      path: item.filename,
      fileName: name,
      at: Date.now(),
    });
  } catch (e) {
    return setSave(id, "disk", { state: "error", error: e.message || String(e) });
  }
}

/** Removes the saved file from this computer (Downloads/Tape or the chosen folder). */
export async function deleteFromDisk(save) {
  if (save?.state !== "saved") return;
  if (save.where === "downloads" && save.downloadId) {
    try {
      await chrome.downloads.removeFile(save.downloadId);
    } catch {
      // Already moved or deleted by hand; still drop it from Chrome's list.
    }
    await chrome.downloads.erase({ id: save.downloadId }).catch(() => {});
    return;
  }
  if (save.where === "folder") {
    const f = await getFolder();
    if (!f || f.name !== save.folder) throw new Error(`Recording deleted. Delete ${save.fileName} from ${save.folder} yourself; Tape no longer has that folder.`);
    if (f.permission !== "granted" && (await f.handle.requestPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error(`Recording deleted. Tape wasn't allowed into ${save.folder}, so the file is still there.`);
    }
    await f.handle.removeEntry(save.fileName).catch(() => {});
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    let downloadId = null;
    let finished = false;
    // A small file can finish before download() even calls back, so listen first
    // and also check the state once the id is known.
    const settle = (item) => {
      if (finished || !item || (item.state !== "complete" && item.state !== "interrupted")) return;
      finished = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      URL.revokeObjectURL(url);
      if (item.state === "complete") resolve(item);
      else reject(new Error(item.error ? `Download interrupted (${item.error}).` : "Download interrupted."));
    };
    const check = () => chrome.downloads.search({ id: downloadId }, ([item]) => settle(item));
    const onChanged = (d) => {
      if (downloadId !== null && d.id === downloadId && d.state) check();
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false }, (id) => {
      if (chrome.runtime.lastError || !id) {
        chrome.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(url);
        return reject(new Error(chrome.runtime.lastError?.message || "Download failed."));
      }
      downloadId = id;
      check();
    });
  });
}

export async function showInFolder(save) {
  if (save?.where === "downloads" && save.downloadId) {
    const [item] = await chrome.downloads.search({ id: save.downloadId });
    if (item && item.exists !== false && item.state === "complete") return chrome.downloads.show(save.downloadId);
  }
  chrome.downloads.showDefaultFolder();
}

// ---------- share server ----------

const trimUrl = (u) => (u || "").trim().replace(/\/+$/, "");

export async function testServer(url, token) {
  const res = await fetch(`${trimUrl(url)}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error("The server rejected the owner token.");
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return res.json();
}

export async function uploadToServer(id, blob, onProgress) {
  const { server } = await getSettings();
  const base = trimUrl(server.url);
  if (!base || !server.token) throw new Error("Add your Tape server in Settings first.");
  const rec = await getRecording(id);
  const thumb = await getThumb(id).catch(() => null);

  const form = new FormData();
  form.append("meta", JSON.stringify({ title: rec.title, duration_ms: rec.durationMs, mime: rec.mime, storage: "local" }));
  form.append("video", blob, fileName(rec));
  if (thumb) form.append("thumb", thumb, "thumb.jpg");

  await setSave(id, "server", { state: "saving", progress: 0 });
  try {
    const video = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${base}/api/videos`);
      xhr.setRequestHeader("Authorization", `Bearer ${server.token}`);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error(xhr.response?.error || `Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error(`Could not reach ${base}.`));
      xhr.send(form);
    });
    return setSave(id, "server", { state: "saved", slug: video.slug, url: video.url, base, at: Date.now() });
  } catch (e) {
    return setSave(id, "server", { state: "error", error: e.message });
  }
}

export async function renameOnServer(rec) {
  const s = rec.saves?.server;
  if (s?.state !== "saved") return;
  const { server } = await getSettings();
  await fetch(`${s.base}/api/videos/${s.slug}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: rec.title }),
  }).catch(() => {});
}

export async function deleteOnServer(rec) {
  const s = rec.saves?.server;
  if (s?.state !== "saved") return;
  const { server } = await getSettings();
  await fetch(`${s.base}/api/videos/${s.slug}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${server.token}` },
  }).catch(() => {});
}
