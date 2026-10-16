# Product

<!-- impeccable:product-schema 1 -->

> Written from the original request with no interview: the user said "take the best decisions, I approve everything". Every line marked *(inferred)* is an assumption made on their behalf.

## Platform

web

## Stack

delegated: a Chrome Manifest V3 extension in plain ES modules (no bundler, loads unpacked as is), plus an optional self-hosted share server in Rust (Axum + SQLite). Chosen because the extension must load without a build step and the user asked for Rust/Axum if a backend is needed.

## Users

People who explain things on screen to someone who is not in the room: engineers walking a reviewer through a PR, designers narrating a prototype, support staff showing a fix. *(inferred)* They record in the middle of other work, usually in one take, and want a link to paste within seconds of stopping.

## Product Purpose

Tape is a Loom-style screen and camera recorder that lives in the browser. A recording never goes to a third-party video host. In v1 it is saved to the user's own computer the moment they stop, and it can also go to a share server they run themselves. Success is "stop recording, file on disk (and a link on the clipboard when they run a server)" without handing the video to a vendor.

## Positioning

Loom keeps your videos on Loom's servers. Tape keeps them where you already keep files: your disk, or your own box. The share link points at storage you own.

## Operating Context

- Started from the toolbar button or a keyboard shortcut while the user is on some other web page.
- Records the current tab, a window, or the whole screen, with an optional circular camera bubble over the page and microphone audio.
- Recording keeps going while the user switches tabs and navigates.
- After stopping, a review page opens with the video, a title, and the save destinations.

## Capabilities and Constraints

- Modes: screen + camera, screen only, camera only. Sources: this tab, a window or the whole screen.
- Countdown, pause/resume, restart, cancel, timer, camera bubble that can be dragged and resized.
- v1 destinations: this computer (Downloads/Tape or a folder the user picks), plus an optional self-hosted tape-server for share links, view counts and timestamped comments.
- Local first for v1: the user asked mid-build to save locally in the initial version. Google Drive is a later version; it needs the user's own Google Cloud OAuth client. *(user decision, 2026-10-16)*
- No video editing beyond title in v1 (no trim). *(inferred, undecided)*

## Brand Commitments

None yet. Name "Tape" is a placeholder chosen by Claude. *(inferred)*

## Evidence on Hand

No users, testimonials, metrics, or press. Do not invent any.

## Product Principles

1. The video belongs to the person who recorded it. Never route media through a service they did not choose.
2. Stop to link in seconds. Every extra step after stopping is a cost.
3. Stay out of the way while recording. The controls are small, movable, and never cover the thing being explained.
4. Work without the server. The Rust server adds share pages; the extension is complete without it.

## Accessibility & Inclusion

Controls reachable by keyboard; recording state never shown by color alone (timer and labels too). *(inferred)*
