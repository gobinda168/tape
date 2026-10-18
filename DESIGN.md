---
name: Tape
description: A screen recorder whose interface is a dark screening room, so the recording is the brightest thing on screen.
colors:
  record-red: "#f2412f"
  record-red-press: "#d8331f"
  record-red-ink: "#ff8f80"
  paused-yellow: "#f5c542"
  instrument: "#111317"
  instrument-raised: "#1c1f24"
  instrument-hover: "#24282e"
  room: "#08090b"
  text: "#f4f5f7"
  text-2: "#a9afb9"
  text-3: "#868d99"
typography:
  display: { fontFamily: "Geist", fontSize: "40px", fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.1 }
  title: { fontFamily: "Geist", fontSize: "28px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.2 }
  body: { fontFamily: "Geist", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
  mono: { fontFamily: "Geist Mono", fontSize: "12-13px", fontWeight: 500, fontFeature: "tnum" }
rounded: { control: "10px", panel: "16px", record: "999px" }
---

# Design System: Tape

## North Star: "The Screening Room"

You come to Tape to record and to watch. The interface is a dark room and the recording is
the light source: the library spills a blurred copy of the video's own frame around the
player, so each recording tints the page it sits on. Everything else is quiet glass on
near-black, and one colour, record red, means "recording" or "stop".

Dark is a choice, not a default: video reads best in a dark room, and the popup and the
recording bar sit over other people's pages, where a dark instrument stays legible on any
background.

## Colour

- **Record red** is the only accent: the Start button, the Stop pill on the bar, the lens
  centre in the mark, and trouble (a muted mic, a failed save). Never decoration.
- **Paused yellow** is the one other state colour, for the paused bar.
- Surfaces are translucent white over the room (`--surface` 3.5%, `--surface-2` 6%), edged
  with a 1px hairline (8%) and a 6% highlight along the top edge (`--edge`), so panels read
  as glass catching light, not as boxes.
- Primary buttons are light on dark: after the video, the brightest control on the page.
- Saved and linked states are neutral chips with an icon and a label. Colour is for trouble.

## Type

Geist for everything, tracked tight above 20px (-0.03 to -0.04em); Geist Mono with tabular
numerals for anything that ticks or measures: times, durations, sizes, paths, shortcuts.

## Shape

Controls 10px. Panels and video frames 16px. Full round only for the things you record with:
the Start and Stop buttons, the camera bubble, the recording bar, toasts.

## Depth and light

- The **glow**: a 32% opacity, 80px-blurred copy of the recording's thumbnail behind the
  player. It is the one authored moment and the reason the page is dark.
- A faint radial wash from the top of every page, like a screen at the front of the room.
- Glass (backdrop blur) only where something floats over content: the top bar, the player's
  control strip, the recording bar, toasts. Solid fallback under reduced transparency.

## Motion

Ease-out (0.16, 1, 0.3, 1). The player rises in; the recordings list slides in with a short
stagger; the bar enters with a blur-in. A fresh recording develops (blurred to sharp) while
it saves. Everything collapses to instant under reduced motion.

## Surfaces

- **Popup** (340px): mode and source segments, a live camera viewfinder, a mic waveform that
  turns into a red "No sound from this mic" warning on digital silence, the red Start button.
- **Recording bar**: glass capsule with a red Stop pill and timer, pause, restart, delete,
  camera toggle; tooltips name the action and shortcut. A red note pins to it if the mic
  goes quiet mid-take.
- **Library**: lit player, editable 28px title, mono meta line, a glass panel of where the
  recording lives, and a list of recordings (thumbnail left, title and mono meta right).
- **Settings and setup**: 720px column of glass panels.
