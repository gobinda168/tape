# What Loom users are angry about, and what Tape does about it

Source: 600 Chrome Web Store reviews of the Loom extension (2019 to Oct 2026, 2.7/5 from 10.2K
ratings); 209 one-to-three-star reviews from 2024-2026 read closely. Shares are of those 209.

| # | Complaint (share) | Tape today | Plan |
|---|---|---|---|
| 1 | Paywalls: no download, 5-min cap, trim is paid (~35%) | File saved to disk on stop, no cap, no account | Free trim in the library (stage 4) |
| 2 | Audio or camera silently not captured (~25%) | Popup waveform + muted-mic warning before recording; mic failure blocks start | **Stage 1**: watch the mic *during* the recording, warn on the bar when it goes silent, flag silent takes in the library |
| 3 | Won't start, does nothing (~18%) | Errors are named | Covered by stages 1-2; keep every failure visible |
| 4 | Intrusive controls, button injected on every page (~18%) | Small draggable bar, but a content script + fonts load on every page | **Stage 3**: nothing on a page unless it is recording; the bar follows the tab you are on |
| 5 | Crashes, recordings lost or never processed (~17%) | Chunks only in memory: closing the recorder tab or a crash loses the take | **Stage 2**: write chunks to IndexedDB as they arrive; recover an interrupted take into the library |
| 6 | Account forced, sign-in loops (~14%) | No account | Keep it that way |
| 7 | Worse after Atlassian, AI bloat (~13%) | Small tool | Keep it small |
| 8 | Breaks host pages, too many permissions (~5%) | Shadow-root overlay, but runs everywhere | Stage 3 |

Praise to keep: one click to a link, screen + camera bubble together, feels personal.
