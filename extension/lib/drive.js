// Google Drive: the recording goes to a "Tape" folder in the user's own Drive.
// Sign-in is chrome.identity.launchWebAuthFlow with the user's own OAuth client (a
// "Web application" client whose redirect URL is chrome.identity.getRedirectURL()).
// Tokens last an hour and are renewed silently; nothing is stored but the account email.

import { getSettings, setSettings } from "./settings.js";
import { getRecording, updateRecording, kvGet, kvSet } from "./db.js";
import { fileName } from "./format.js";
import { authUrl, parseTokenRedirect } from "./drive-auth.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

const setSave = (id, value) =>
  updateRecording(id, (r) => ({ ...r, saves: { ...(r.saves || {}), drive: value } }));

export const redirectUrl = () => chrome.identity.getRedirectURL();

async function signIn(interactive) {
  const { drive } = await getSettings();
  if (!drive.clientId) throw new Error("Add your Google OAuth client ID in Settings first.");
  const url = authUrl({ clientId: drive.clientId, redirectUri: redirectUrl(), interactive, loginHint: drive.email });
  let back;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url, interactive });
  } catch (e) {
    throw new Error(interactive ? "Google sign-in was closed." : "Google needs you to sign in again.");
  }
  const t = parseTokenRedirect(back);
  await chrome.storage.session.set({ driveToken: t });
  return t.token;
}

/** A valid token: cached, else renewed silently, else (only if allowed) by asking. */
async function token({ interactive = false } = {}) {
  const { driveToken: t } = await chrome.storage.session.get("driveToken");
  if (t && t.expiresAt - Date.now() > 60_000) return t.token;
  try {
    return await signIn(false);
  } catch (e) {
    if (!interactive) throw e;
    return signIn(true);
  }
}

async function api(path, { method = "GET", body, headers = {}, base = API, interactive = false } = {}) {
  let tok = await token({ interactive });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${tok}`, ...(body && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body && !(body instanceof Blob) ? JSON.stringify(body) : body,
    });
    if (res.status === 401 && attempt === 0) {
      await chrome.storage.session.remove("driveToken");
      tok = await token({ interactive });
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || `Google Drive answered ${res.status}.`);
    }
    return res;
  }
}

// ---------- account ----------

/** Must run from a click: opens Google's account chooser. */
export async function connectDrive() {
  await chrome.storage.session.remove("driveToken");
  await signIn(true);
  const about = await (await api("/about?fields=user(emailAddress,displayName)")).json();
  const { drive } = await getSettings();
  await setSettings({ drive: { ...drive, email: about.user.emailAddress, name: about.user.displayName } });
  return about.user;
}

export async function disconnectDrive() {
  const { driveToken: t } = await chrome.storage.session.get("driveToken");
  if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.token)}`, { method: "POST" }).catch(() => {});
  await chrome.storage.session.remove("driveToken");
  await kvSet("driveFolder", null).catch(() => {});
  const { drive } = await getSettings();
  await setSettings({ drive: { ...drive, email: "", name: "", autoUpload: false } });
}

export const driveReady = (settings) => !!(settings.drive.clientId && settings.drive.email);

// ---------- the Tape folder ----------

const FOLDER = "application/vnd.google-apps.folder";

async function tapeFolder() {
  const cached = await kvGet("driveFolder").catch(() => null);
  if (cached) {
    const res = await api(`/files/${cached}?fields=id,trashed`).catch(() => null);
    const f = res && (await res.json());
    if (f && !f.trashed) return f.id;
  }
  // drive.file only sees what Tape made, so this finds Tape's own folder.
  const q = encodeURIComponent(`name = 'Tape' and mimeType = '${FOLDER}' and trashed = false`);
  const found = await (await api(`/files?q=${q}&fields=files(id)&pageSize=1`)).json();
  const id = found.files[0]?.id || (await (await api("/files?fields=id", { method: "POST", body: { name: "Tape", mimeType: FOLDER } })).json()).id;
  await kvSet("driveFolder", id);
  return id;
}

// ---------- upload ----------

export async function uploadToDrive(id, blob, onProgress, { interactive = false } = {}) {
  const rec = await getRecording(id);
  const { drive } = await getSettings();
  await setSave(id, { state: "saving", progress: 0 });
  try {
    const tok = await token({ interactive });
    const parent = await tapeFolder();
    // Resumable upload: one session, one PUT with progress.
    const start = await api("/files?uploadType=resumable&fields=id,webViewLink", {
      base: UPLOAD,
      method: "POST",
      headers: { "X-Upload-Content-Type": blob.type || "video/mp4", "X-Upload-Content-Length": String(blob.size) },
      body: { name: fileName(rec), parents: [parent], description: "Recorded with Tape" },
    });
    const session = start.headers.get("Location");
    const file = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", session);
      xhr.setRequestHeader("Authorization", `Bearer ${tok}`);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error(xhr.response?.error?.message || `Upload failed (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error("Could not reach Google Drive."));
      xhr.send(blob);
    });
    if (drive.anyoneWithLink) {
      await api(`/files/${file.id}/permissions`, { method: "POST", body: { role: "reader", type: "anyone" } });
    }
    return setSave(id, { state: "saved", fileId: file.id, url: file.webViewLink, shared: !!drive.anyoneWithLink, at: Date.now() });
  } catch (e) {
    return setSave(id, { state: "error", error: e.message });
  }
}

export async function renameOnDrive(rec) {
  const d = rec.saves?.drive;
  if (d?.state !== "saved") return;
  await api(`/files/${d.fileId}`, { method: "PATCH", body: { name: fileName(rec) } }).catch(() => {});
}

/** Moves the file to the Drive bin (recoverable for 30 days), never a hard delete. */
export async function trashOnDrive(rec) {
  const d = rec.saves?.drive;
  if (d?.state !== "saved") return;
  await api(`/files/${d.fileId}`, { method: "PATCH", body: { trashed: true } }).catch(() => {});
}
