---
name: Tape
description: A browser screen and camera recorder whose recordings are instant prints you own.
colors:
  spectrum-red: "#e5402f"
  spectrum-red-press: "#c9321f"
  spectrum-orange: "#f08a24"
  spectrum-yellow: "#f2c230"
  spectrum-green: "#3fa15a"
  spectrum-blue: "#2f78c4"
  camera-body: "#1d1e20"
  camera-body-raised: "#27292c"
  camera-body-line: "#34363a"
  camera-body-ink: "#f1f1ef"
  camera-body-ink-2: "#a9abaf"
  camera-body-ink-3: "#8e9196"
  lens-black: "#0f1011"
  tabletop: "#e4e5e7"
  tabletop-2: "#d8d9dc"
  tabletop-dark: "#141516"
  tabletop-2-dark: "#1c1d1f"
  print-white: "#fbfbfa"
  print-white-dark: "#f4f4f2"
  print-ink: "#17181a"
  print-ink-2: "#4c4f54"
  print-ink-3: "#6e7177"
  table-ink: "#17181a"
  table-ink-2: "#464a50"
  table-ink-3: "#62666c"
  table-ink-dark: "#ededeb"
  table-ink-2-dark: "#b4b6ba"
  table-ink-3-dark: "#8d9095"
  hairline: "#d9dadd"
  hairline-dark: "#2c2e31"
  field: "#ffffff"
  field-dark: "#1f2023"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  timer:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "48px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  mono-small:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  print: "3px"
  key: "4px"
  control: "6px"
  full: "999px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  gutter: "40px"
components:
  button-default:
    backgroundColor: "{colors.field}"
    textColor: "{colors.table-ink}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.table-ink}"
    textColor: "{colors.tabletop}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.table-ink-2}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-quiet-hover:
    backgroundColor: "{colors.tabletop-2}"
    textColor: "{colors.table-ink}"
  button-danger:
    backgroundColor: "{colors.spectrum-red}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.spectrum-red-press}"
  button-start:
    backgroundColor: "{colors.spectrum-red}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    height: "48px"
    width: "100%"
  button-start-hover:
    backgroundColor: "{colors.spectrum-red-press}"
  input-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.table-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "38px"
  print-large:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.print-ink}"
    rounded: "{rounded.print}"
    padding: "16px 16px 0"
  print-small:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.print-ink}"
    rounded: "{rounded.print}"
    padding: "7px 7px 0"
  top-bar:
    backgroundColor: "{colors.camera-body}"
    textColor: "{colors.camera-body-ink}"
    height: "56px"
    padding: "0 24px"
  recording-bar:
    backgroundColor: "{colors.camera-body}"
    textColor: "{colors.camera-body-ink}"
    rounded: "{rounded.full}"
    height: "48px"
  state-chip:
    rounded: "{rounded.control}"
    size: "36px"
  segment:
    backgroundColor: "transparent"
    textColor: "{colors.camera-body-ink-2}"
    rounded: "{rounded.control}"
    height: "56px"
  segment-selected:
    backgroundColor: "{colors.camera-body-raised}"
    textColor: "{colors.camera-body-ink}"
---

# Design System: Tape

## Overview

**Creative North Star: "The Instant Print"**

A recording is an instant photograph. The controls you hold are the camera: charcoal plastic, one red button, a short five-band stripe beside the wordmark. What comes out is a print: a cool white frame with a thick bottom margin, lying on a grey tabletop with others you have taken. You stop, the print develops while it saves, and it is yours.

The world splits cleanly into two materials. **Camera body** is always dark, in both colour schemes, because it is a physical object: the popup, the in-page recording bar, the camera bubble ring, the countdown lens, the player's control strip, the toast, and the 56px top bar of every page. **Tabletop and prints** carry the library, settings, setup and share page; the tabletop follows the colour scheme (cool grey by day, near-black at night) while prints stay paper-white in both, because paper does not invert. Density is calm and functional: each surface shows only the next decision.

Colour is a signal system, not decoration. The five spectrum hues each mean one thing about a recording's state, and the full stripe appears only as the 30x4 maker's mark. One family, Geist, carries everything from the 84px countdown numeral to 11px captions; Geist Mono takes over wherever a value is a number that changes or a path you might copy.

**Key Characteristics:**
- Two materials: always-dark camera body for chrome, paper prints on a scheme-following tabletop for content.
- Spectrum hues are state only; the full stripe is a 30x4 mark beside the wordmark and nowhere else.
- Progress is development: a fresh print starts murky and resolves as the save completes.
- One sans family for all roles, mono for timers, durations, sizes, paths and counts.
- Small radii on controls (6px) and prints (3px); full round for the record button, recording bar, bubble and chips that sit on the body.

## Colors

A neutral charcoal-and-paper ground with five saturated instant-camera hues held back for state.

### Primary
- **Record Red** (spectrum-red): recording in progress (Start button, recording bar Stop, live dot, the lens centre in the mark), and also failure and destruction (failed-save chip and its strike-through, Delete, the error banner tint). Pressed and hover go to **Red Press** (spectrum-red-press).

### Secondary
- **Paused Yellow** (spectrum-yellow): paused or working. The recording bar's Stop turns yellow with dark ink when paused; the popup's live dot turns yellow.
- **Disk Orange** (spectrum-orange): saved on this computer. The destination row chip, the small-print tag, the folder icon in the top-bar "Saving to" pill, the setup step for the save folder.
- **Link Blue** (spectrum-blue): has a share link, plus the system's one interactive colour: focus rings, field focus, text links, comment timestamps, selection tint.
- **Done Green** (spectrum-green): a setup step is done, a connection test succeeded.

### Neutral
- **Camera Body** (camera-body): popup, recording bar, top bar, toast, countdown lens. Raised plastic (camera-body-raised) for hover, selected segments and fields on the body; seams (camera-body-line) as 1px inset strokes.
- **Body Ink** (camera-body-ink, -2, -3): primary, secondary and tertiary text on the body. The popup mic level ring is drawn in body ink at 55%, not a spectrum hue.
- **Lens Black** (lens-black): the video well inside every print and the player.
- **Tabletop** (tabletop, tabletop-2; dark: tabletop-dark, tabletop-2-dark): the page ground and its recessed wells (confirm panel, idle chips, kbd, quiet hover).
- **Print White** (print-white; dark: print-white-dark): the print frame. **Print Ink** (print-ink, -2, -3) is the text on it and never changes with the scheme.
- **Table Ink** (table-ink, -2, -3, and dark variants): text that sits directly on the tabletop; inverts with the scheme.
- **Hairline** (hairline; dark: hairline-dark): row dividers and control strokes. **Field** (field; dark: field-dark): inputs and default buttons.

### Named Rules
**The State-Only Spectrum Rule.** Red records (and marks failure), yellow is paused or working, orange is saved on this computer, blue is a share link, green is a step done. No spectrum hue is used for decoration, emphasis or brand colour, and state is never colour alone: every chip carries an icon and every state a text label.

**The One Stripe Rule.** The five-band stripe appears only as the 30x4 mark beside the wordmark, 2px radius, bands equal width in red, orange, yellow, green, blue order.

**The Paper Does Not Invert Rule.** Prints keep print-white and print ink in dark mode; only the tabletop, table ink, hairlines and fields switch.

## Typography

**Display Font:** Geist (with ui-sans-serif, system-ui)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono (with ui-monospace, SF Mono, Menlo)

**Character:** One quiet grotesque does every job, set tight and slightly negative-tracked at sizes above 16px; the mono reads like the frame counter on a camera.

### Hierarchy
- **Display** (600, 32px, 1.15, -0.025em): settings and setup page titles. The permissions page uses 28px; the countdown numeral is 84px at -0.04em.
- **Headline** (600, 22px, 1.25, -0.015em): the print title in the bottom margin, editable in place; 24px on the share page, 20px below 960px.
- **Title** (600, 14px, 1.3): destination row names, section heads ("All recordings"), small print titles (13px, two-line clamp), group heads (17px).
- **Body** (400, 15px, 1.5 on pages; 14px, 1.45 in the popup): running text, ledes capped near 56-62ch.
- **Label** (400-500, 13px): meta lines on prints, details, hints (12-13px, ink-3), popup field labels (12px).
- **Timer** (Geist Mono 500, 48px popup / 56px recorder page, tabular): the live recording clock.
- **Mono small** (Geist Mono 500, 11-12.5px, tabular): durations on thumbnails, player time, counts, file paths, kbd keys.

### Named Rules
**The One Family Rule.** Geist carries display and caption alike; no second display face, no uppercase tracked labels.

**The Counter Rule.** Anything that ticks, measures or locates (time, duration, size, count, path) is Geist Mono with tabular numerals.

## Layout

The library is a two-column table: the newest print large on the left (fluid), a contact sheet of older prints on the right (300-380px column, two-up grid, 16px gap), 40px gutter, max width 1480px, 32px page padding. The share page mirrors it with comments in the right column (max 1400px, 300-360px column). Settings and setup are a single 720px sheet with groups divided by hairlines and 36px of air.

Rhythm runs on 8, 14, 16, 24, 32 and 40px: 14px row padding in destination and settings rows, 16px print padding, 24px bar and page edge padding, 32px page padding, 40px column gutter.

Responsive: below 960px the library and share page collapse to one column (16px padding), the contact sheet becomes an auto-fill grid of 160px prints, and the top-bar destination pill drops its label to a 36px icon. Below 560px destination rows stack their actions under the text and the large print's padding drops to 10px. Below 520px the player hides the centre play button, mute and total duration, keeping play, time, scrub and fullscreen in a 40px strip.

The popup is a fixed 340px column. The recording bar and camera bubble float on the host page and are draggable; the bar carries only stop, pause, restart and cancel.

## Elevation & Depth

Depth is physical: prints lie on the table with a soft two-part contact shadow and lift on hover; camera-body objects float over the host page with deep, diffuse drops. Within the body, depth is tonal (raised plastic) plus 1px inset seams, never shadows.

### Shadow Vocabulary
- **Print rest** (`box-shadow: 0 1px 1px rgb(23 24 26 / 0.06), 0 6px 18px -6px rgb(23 24 26 / 0.18)`; dark: `0 1px 1px rgb(0 0 0 / 0.4), 0 10px 26px -8px rgb(0 0 0 / 0.7)`): every print at rest, the camera check circle.
- **Print lift** (`box-shadow: 0 2px 4px rgb(23 24 26 / 0.08), 0 18px 40px -12px rgb(23 24 26 / 0.28)`): a small print on hover, paired with a 2px rise and -0.4deg turn.
- **Floating body** (`box-shadow: inset 0 0 0 1px #34363a, 0 12px 32px -10px rgb(0 0 0 / 0.55)`): recording bar, cancel confirm, camera bubble (with a 3px body ring), toast.
- **Focus** (`box-shadow: 0 0 0 2px var(--table), 0 0 0 4px var(--blue)` or `outline: 2px solid #2f78c4; outline-offset: 2px`): every focusable element.

### Named Rules
**The Lying Flat Rule.** Prints rest and lift; nothing else on the tabletop casts a shadow. Buttons and fields use inset 1px strokes instead.

## Shapes

Small, honest corners. Controls (buttons, inputs, selects, state chips, option cards, segments) are 6px. Prints are 3px, like trimmed photo paper; the small tags on a print are 3px too. Keys and inline code are 4px. Full round belongs to the things that are round on a camera: the record/Start button, the recording bar and its buttons, the camera bubble, the countdown lens, the mic and camera previews, the player strip and its buttons, the toast and the top-bar destination pill. The lens mark is a 16px radial target: red centre, body ring, grey rim.

A print is defined by its asymmetric margin: equal thin sides and top (16px large, 7px small), a thick bottom margin that holds the title and the destination marks.

## Components

### Buttons
Tactile and quiet; they press down 1px.
- **Shape:** gently squared (6px), 36px tall on pages, 44px on the permissions page.
- **Default:** field background, table ink, 1px inset hairline, Geist 500 14px; hover darkens the stroke.
- **Primary:** inverted ink (table ink ground, tabletop text). One per action group: Copy link, Save.
- **Quiet:** transparent, ink-2; hover fills tabletop-2.
- **Danger:** Record Red, white text; hover Red Press.
- **On body:** transparent with a 1px body-line stroke, raised plastic on hover.
- **Start / Stop (signature):** full-round 48px Record Red with a white label and record icon, a 2px inner bottom shade; disabled turns raised plastic. Never a bare round button.

### Chips
- **State chip:** 36px square, 6px radius, solid spectrum fill with an icon (dark ink on orange and yellow, white on red, blue, green); idle is tabletop-2 with ink-2. Pulses opacity while saving.
- **Print tag:** 16px, 3px radius, same fills, stacked in the print's bottom margin.
- **Destination pill (top bar):** full round, 32px, body-line stroke, orange folder icon, body ink-2 label.

### Cards / Containers
- **Corner Style:** prints 3px; option cards and confirm panels 6px.
- **Background:** print white on tabletop; recessed panels in tabletop-2.
- **Shadow Strategy:** print rest / print lift only (see Elevation).
- **Border:** none on prints; option cards use an inset hairline that becomes a 2px ink stroke when selected.
- **Internal Padding:** 16px (large print), 7px (small print), 14-16px (option cards).

### Inputs / Fields
- **Style:** 38px, field background, 6px radius, 1px inset hairline; selects carry a drawn chevron. On the body, selects are 32px raised plastic with body ink.
- **Focus:** inset 2px Link Blue stroke.
- **Switch:** 40x24 full-round track, tabletop-2 off, table ink on, knob slides 16px.
- **Error:** Record Red text; a failed save is a struck mono path with the reason, plus Retry, and never disappears.

### Navigation
The 56px camera-body top bar: lens + "Tape" (600, 16px) + stripe mark on the left; destination pill and a 36px Settings icon button on the right. Sub-pages use a quiet "Back" text link. The popup header repeats the mark at 15px with Library and Settings icon buttons.

### Recording Bar (signature)
A 48px full-round camera-body capsule on the host page: grip, red Stop pill with blinking record icon and mono timer, then 36px round icon buttons for pause, restart, cancel, split by a 1px seam. Paused turns Stop yellow with dark ink; saving dims every button. Cancel asks in a small confirm panel above the bar.

### Print (signature)
The recording itself. A large print holds the player inside its frame and an editable 22px title in the bottom margin, meta line in ink-3, destination rows beneath. Small prints form the contact sheet with a mono duration badge on the photo and state tags in the margin; the current one carries a 2px ink ring.

**The Develop Rule.** A fresh print starts murky (blur 18px, saturation 0.2, contrast 0.6 under a warm-to-slate cast at 86%) and develops to full image over 2200-2400ms as the save completes; progress is the development, never a spinner. Reduced motion jumps straight to the developed print.

### Player
Lens-black well, a 72px round body-tinted play button centred, and a 44px full-round control strip inset 10px from the bottom: play, mono time, white-on-grey scrub, mute, fullscreen. The strip hides while playing until hover or focus.

## Do's and Don'ts

### Do:
- **Do** build chrome from camera body (#1d1e20) with raised plastic and 1px inset seams, and keep it dark in both colour schemes.
- **Do** put content on prints: print-white frames, 3px corners, thick bottom margin holding title and destination marks.
- **Do** map every spectrum hue to exactly one state and pair it with an icon and a text label.
- **Do** set times, durations, sizes, counts and paths in Geist Mono with tabular numerals.
- **Do** show saving as development of the print, and show failure as a struck row with Retry that stays.
- **Do** use Link Blue for every focus ring (2px, 2px offset).

### Don't:
- **Don't** use the five-band stripe anywhere but the 30x4 mark beside the wordmark.
- **Don't** use a spectrum hue as a brand accent, background wash or decoration; the mic level ring is body ink, not green.
- **Don't** invert prints in dark mode.
- **Don't** add a spinner or progress bar where a print can develop.
- **Don't** put more than stop, pause, restart and cancel on the recording bar.
- **Don't** introduce a second typeface or uppercase tracked labels.
