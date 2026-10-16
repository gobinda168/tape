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

Not in v1: Google Drive saving, trimming, drawing on screen.

Fonts: Geist and Geist Mono (SIL OFL, `extension/fonts/OFL.txt`). Icons: Phosphor (MIT).
