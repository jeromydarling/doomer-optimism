# Doomer Optimism — 60-second podcast promo

A short, contemplative promo built on [HyperFrames](https://hyperframes.heygen.com/).
Renders an HTML composition (60 s) to MP4 via Puppeteer + FFmpeg, headless and
deterministic.

## Concept

The Angelus by Jean-François Millet (1857–1859) provides a slow Ken-Burns
backdrop — peasants pausing in evening prayer in a wheat field, the iconic
agrarian-Catholic tableau. Bach's *Sheep May Safely Graze* plays
underneath. Cormorant Garamond display type fades through the show's
wordmark, central question, lede, six pillars, the "300 episodes"
milestone, and a closing URL card.

## How to render

**Default (CI):** trigger
[`.github/workflows/render-promo.yml`](../.github/workflows/render-promo.yml) —
the runner installs FFmpeg + Puppeteer, fetches the painting + music
fresh, renders the MP4, and publishes it two ways:

- as a **workflow artifact** (Actions tab → run → "promo-N" download)
- as the binary attached to a rolling **`latest-promo`** GitHub release —
  so the URL stays stable and Ashley can grab it from anywhere

This also fires automatically when anything inside `promo/` changes on
`main`, so every edit to the composition produces a fresh render with no
hands-on time.

**Locally** (only if you want to iterate quickly with the in-browser
preview):

```bash
cd promo
./fetch-assets.sh
npm run dev      # live-reload preview in the browser
npm run check    # lint + validate + inspect
npm run render   # produces an MP4 in this directory
```

`fetch-assets.sh` pulls the painting from Wikimedia Commons and the music
from archive.org's Musopen mirror. Both are public domain. If either URL
goes 403 on your network, drop in any equivalent file at
`assets/angelus.jpg` and `assets/music.mp3` — the composition picks them
up unchanged.

## Editing

Open `index.html`. Six numbered "beats" are commented. Each is a
`class="clip"` element with `data-start`, `data-duration`, and
`data-track-index`. The GSAP timeline at the bottom of the file animates
them on a paused, deterministic schedule that HyperFrames seeks through
frame by frame.

If you change beat timings, also adjust the GSAP calls — the runtime
won't auto-sync them.

## Notes

- All timed elements need `class="clip"` — the framework uses it for
  visibility lifecycle.
- Timelines are paused (`{ paused: true }`) and registered on
  `window.__timelines["root"]` — never call `.play()`.
- No `Date.now()`, no `Math.random()`, no `fetch()` in the composition —
  rendering must be deterministic.
- Binary assets (painting, music, rendered MP4s) are gitignored. Source
  composition lives in the repo; rendered output lives in CI artifacts +
  the `latest-promo` release.
