// Google sign-in for Drive, as pure functions (the flow itself is in drive.js).
// Scope drive.file: Tape sees only the files it created, never the rest of your Drive.

export const SCOPE = "https://www.googleapis.com/auth/drive.file";

export function authUrl({ clientId, redirectUri, interactive, loginHint }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: SCOPE,
    prompt: interactive ? "select_account" : "none",
    include_granted_scopes: "true",
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

const ERRORS = {
  access_denied: "You didn't allow Tape to use Google Drive.",
  interaction_required: "Google needs you to sign in again.",
  login_required: "Google needs you to sign in again.",
  consent_required: "Google needs you to sign in again.",
  redirect_uri_mismatch: "Google rejected the redirect URL. Add it to your OAuth client (Settings shows it).",
};

/** The URL Google redirects to: #access_token=…&expires_in=… or #error=… */
export function parseTokenRedirect(url, now = Date.now()) {
  const p = new URLSearchParams(new URL(url).hash.slice(1));
  const error = p.get("error");
  if (error) throw new Error(ERRORS[error] || `Google sign-in failed (${error}).`);
  const token = p.get("access_token");
  if (!token) throw new Error("Google sign-in returned no token.");
  return { token, expiresAt: now + Number(p.get("expires_in") || 3600) * 1000 };
}
