# Doomer Optimism — 60-second podcast promo

A short, contemplative promo built on [HyperFrames](https://hyperframes.heygen.com/).
Renders an HTML composition (60 s) to MP4 via Puppeteer + FFmpeg, headless and
deterministic.

## Audience for this README

This file is written for **Claude in a future session**, not for Ashley.
Ashley does not edit `index.html`. Ashley does not click "Run workflow."
Ashley does not download from GitHub releases. Ashley says, in chat,
something like *"build me a promo for the new Marcin Jakubowski episode"*
and the rest is Claude's job. Treat this README as a runbook.

## Concept

The Angelus by Jean-François Millet (1857–1859) provides a slow Ken-Burns
backdrop — peasants pausing in evening prayer in a wheat field. Bach's
*Sheep May Safely Graze* plays underneath. Cormorant Garamond display
type fades through the show's wordmark, central question, lede, six
pillars, the "300 episodes" milestone, and a closing URL card.

## How Claude renders a promo on Ashley's behalf

1. **Edit `index.html`** — change beat copy (lede, pillars, milestone,
   sign-off) to match what she asked for. Each beat is commented and
   has `data-start` / `data-duration` / `data-track-index` attributes.
   If beat timings change, also adjust the GSAP timeline at the bottom
   of the file — the runtime won't auto-sync.
2. **Push to `main`.** The workflow `.github/workflows/render-promo.yml`
   auto-fires on any change inside `promo/` (path filter). No
   workflow_dispatch click needed.
3. **Wait ~5 minutes.** Poll
   `https://api.github.com/repos/jeromydarling/doomer-optimism/releases/tags/latest-promo`
   until it 200s.
4. **Grab the stable download URL.** Always:
   `https://github.com/jeromydarling/doomer-optimism/releases/download/latest-promo/<filename>.mp4`
5. **Deliver to Ashley.** Either drop the link in chat, or send via
   the Gmail MCP if she wants it emailed.

She uploads the MP4 to YouTube / Instagram / X herself, or asks Claude
to do that too once we wire those MCPs in.

## Iterating quickly (rare; only when fine-tuning timing)

If the in-CI render loop is too slow for tight iteration, the local
preview is still available:

```bash
cd promo
./fetch-assets.sh    # painting + music
npm run dev          # live-reload preview in the browser
```

Don't ship a local render — let CI do the canonical build so the
output is reproducible and the release tag stays in sync with `main`.

## Composition rules (HyperFrames specifics)

- All timed elements need `class="clip"` — the framework uses it for
  visibility lifecycle.
- Timelines are paused (`{ paused: true }`) and registered on
  `window.__timelines["root"]` — never call `.play()`.
- No `Date.now()`, no `Math.random()`, no `fetch()` in the composition —
  rendering must be deterministic.
- Binary assets (painting, music, MP4 output) are gitignored. Only the
  HTML composition lives in the repo; rendered MP4s live as release
  assets.

## Files

- `index.html` — root composition, six numbered beats
- `fetch-assets.sh` — pulls public-domain Angelus + BWV 208 recording
- `package.json` — `npm run dev / check / render` shortcuts
- `hyperframes.json`, `meta.json` — framework config
- `assets/` — gitignored; populated by `fetch-assets.sh`
