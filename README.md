# Tape

A Loom-style screen recorder for Chrome that keeps your videos on storage you own.

- **Record** this tab, a window or your whole screen, with a draggable camera bubble and your microphone. Or record just the camera.
- **Countdown, pause, restart, cancel** from a small bar on the page, the popup, or the keyboard (`Alt+Shift+R` start/stop, `Alt+Shift+P` pause).
- **Saved to your computer the moment you stop**: `Downloads/Tape/` by default, or a folder you pick. The library keeps a playable copy.
- **Optional share links** from `tape-server`, a small Rust (Axum + SQLite) server you run yourself: share page, view count and timestamped comments.

Nothing is sent anywhere unless you set up your own server.

```
extension/   Chrome MV3 extension, plain ES modules, no build step
server/      tape-server (Rust, Axum, SQLite): optional share links
```

## Install the extension

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** and pick the `extension/` folder.
3. Tape opens its setup page: allow camera and microphone, choose where recordings go, pin Tape in the toolbar.

Requires Chrome 116 or newer (any Chromium browser with the offscreen and tabCapture APIs).

### How recording works

| You pick | Recorded by | Notes |
|---|---|---|
| This tab | an offscreen document using `chrome.tabCapture` | Keeps recording while you navigate the tab. The tab's sound is recorded and still plays. |
| Window or screen | a small recorder tab using `getDisplayMedia` | Chrome only shows its screen picker from a real tab. Tape switches you back to your page. Keep the recorder tab open. |
| Camera only | the offscreen document | The bubble on the page is your preview. |

The camera bubble is an extension iframe, so camera permission belongs to Tape, not to each site. Recordings are MP4 (H.264/AAC) where Chrome supports it, otherwise WebM with the duration fixed so the file can be scrubbed.

Chrome does not allow capturing its own pages (`chrome://`, the Web Store). Record a window or the screen there instead.

## Transcription with a local model (optional)

Tape can transcribe a recording with a speech model **running on your own computer**. The
audio goes only to that model. Each transcript line is timestamped: click it to jump the
video there, follow along as it plays, or copy the whole thing.

Tape talks to any server with an OpenAI-style `POST /v1/audio/transcriptions` endpoint
(whisper.cpp's server, Speaches, LocalAI, ...). This repo includes one for
[Parakeet Redux](https://huggingface.co/moondream/parakeet-redux) (178 MB, 25 languages,
word timestamps, about 15-40x real time on a Mac):

```sh
uv run transcribe/tape_transcribe.py     # first run downloads the model; listens on 127.0.0.1:8790
```

To keep it running in the background on a Mac (starts at login, restarts if it stops, logs
to `~/Library/Logs/tape-transcribe.log`):

```sh
transcribe/install-macos.sh              # install and start
transcribe/install-macos.sh uninstall    # stop and remove
```

In Tape: **Settings -> Transcription**, model server `http://127.0.0.1:8790`, **Save and
test**. Turn on **Transcribe every new recording** to have it run after each save.

## Google Drive (optional)

Tape can save each recording to a **Tape** folder in your own Google Drive and, if you turn
it on, make the Drive link viewable by anyone who has it. Tape asks only for the
`drive.file` permission, so it can see the files it created and nothing else in your Drive.

Google needs an OAuth client that belongs to you (one time, about five minutes):

1. Open [Google Cloud console](https://console.cloud.google.com/), create a project (any name).
2. **APIs & Services → Library**: enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and
   your email, add the scope `.../auth/drive.file`, and add your Google account under
   **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type
   **Web application**. Under **Authorized redirect URIs** paste the redirect URL that
   Tape shows in **Settings → Google Drive** (it looks like
   `https://<extension-id>.chromiumapp.org/`).
5. Copy the client ID into **Settings → Google Drive**, **Save**, then **Connect Google Drive**.

The redirect URL contains the extension's ID, which comes from the folder you loaded it
from. If you move the `extension/` folder, add the new redirect URL to the same client.

## Share links (optional)

```sh
cd server
cargo run --release            # prints "Owner token: ..." on first start
```

In Tape: **Settings → Share server**, enter `http://127.0.0.1:8787` and the owner token, then **Save and test**. Each recording then has **Get link**, or turn on **Upload every new recording** to have the link copied as soon as you stop. See [server/README.md](server/README.md) for env vars, the API, Docker and running it behind TLS.

## Development

```sh
cd server && cargo test && cargo clippy --all-targets -- -D warnings
```

The extension has no build. Reload it in `chrome://extensions` after edits.

Not in v1: trimming, drawing on screen.

Fonts: Geist and Geist Mono (SIL OFL, `extension/fonts/OFL.txt`). Icons: Phosphor (MIT).
