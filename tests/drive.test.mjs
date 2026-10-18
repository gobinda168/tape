// Google sign-in helpers for Drive. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl, parseTokenRedirect } from "../extension/lib/drive-auth.js";

const base = { clientId: "123.apps.googleusercontent.com", redirectUri: "https://abc.chromiumapp.org/" };

test("sign-in asks only for the files Tape creates, and lets you pick the account", () => {
  const u = new URL(authUrl({ ...base, interactive: true }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("client_id"), base.clientId);
  assert.equal(u.searchParams.get("redirect_uri"), base.redirectUri);
  assert.equal(u.searchParams.get("response_type"), "token");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(u.searchParams.get("prompt"), "select_account");
});

test("a silent refresh shows no UI and names the account already connected", () => {
  const u = new URL(authUrl({ ...base, interactive: false, loginHint: "me@example.com" }));
  assert.equal(u.searchParams.get("prompt"), "none");
  assert.equal(u.searchParams.get("login_hint"), "me@example.com");
});

test("the redirect gives back the token and when it expires", () => {
  const t = parseTokenRedirect("https://abc.chromiumapp.org/#access_token=ya29.abc&token_type=Bearer&expires_in=3599&scope=x", 1000);
  assert.deepEqual(t, { token: "ya29.abc", expiresAt: 1000 + 3599 * 1000 });
});

test("a refused or failed sign-in becomes a readable error", () => {
  assert.throws(() => parseTokenRedirect("https://abc.chromiumapp.org/#error=access_denied", 0), /didn't allow/);
  assert.throws(() => parseTokenRedirect("https://abc.chromiumapp.org/#error=interaction_required", 0), /sign in again/);
});
