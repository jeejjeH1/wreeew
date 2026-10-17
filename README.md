# GenLayer — freelance disputes motion graphic

A 72-second, 1920×1080, 60fps motion graphic for a Twitter/X post, rendered entirely in code.

- `index.html` + `motion.js` — the canvas animation. `renderFrame(t)` draws any moment, so the timeline can be exported frame by frame. Open `index.html` through a local server to preview it with sound (`?t=25` jumps to a timestamp).
- `audio.py` — synthesizes the 120 BPM soundtrack and places the sound effects on the cues exported from `motion.js`.
- `render.sh` — the full pipeline: export cues → synthesize audio → render 4 video segments in parallel → mux into `genlayer_disputes.mp4`.
- `stills.mjs` — renders single frames for review: `node stills.mjs outdir 4.5 25 70`.

Requires Node with Playwright/Chromium, Python 3 with numpy and scipy, and ffmpeg.
