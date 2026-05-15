# Episode release template

Ashley's reference: [The Sacred](https://www.thesacredpodcast.com) substack,
where each episode opens with:

1. **Big bold serif title**
2. **Italic serif subtitle** (one-sentence framing)
3. **Small avatar byline** — publication caption + date + Listen button
4. **A polished hero image** — two-shot of host + guest, studio-light feel,
   not a screenshot from the video
5. **Body** with drop-cap first paragraph, then transcript / sections

## What changed in this PR

The episode detail page (`/episodes/{slug}`) now uses that pattern:

- Title block at top: title + italic subtitle (auto-derived from the first
  sentence of `summary` if `subtitle` isn't set explicitly)
- Byline row beneath the title: small Ashley hedcut + "Doomer Optimism" +
  date + duration + Listen button
- **Hero image** below the byline (when `heroImage` is set in frontmatter)
- Fallback when `heroImage` isn't set: a typographic placeholder card —
  *never* a YouTube screenshot
- The homepage's "Latest episode" card also uses `heroImage` when present,
  falling back to the YouTube embed only if no image is provided

## How to release a new episode with a proper hero

1. **Produce the hero image.**
   - 1600 × 900 (16:9), JPG preferred
   - Host on one side, guest on the other; both clearly visible
   - Studio-style: clean background, warm light, host and guest both
     looking at camera (or in conversation, looking at each other)
   - NOT a screenshot from the Zoom/YouTube recording
   - Save as `public/episodes/heroes/{episode-slug}.jpg`
     (must match the MDX filename without the `.mdx` extension)

2. **Wire it into the episode MDX:**

   ```yaml
   ---
   number: 304
   title: "The Spiritual Stakes of Right-to-Repair"
   subtitle: "What happens when working people can't fix the tools they depend on."
   guest: "Gord Magill"
   pubDate: 2026-06-01
   heroImage: /episodes/heroes/304-gord-magill-right-to-repair.jpg
   heroImageCredit: "Photo by ..."   # optional
   ...
   ---
   ```

3. **Commit + push to main.** Pages redeploys in ~2 minutes; the new
   episode appears as the homepage latest card with the proper hero,
   and the episode detail page uses the editorial layout.

## Producing the hero image — workflow options

### Option A: Manual (most polished)
- Schedule a brief Zoom session with the guest where the goal is to
  capture a usable still. Have the guest hold a "look at camera" pose
  for 5–10 seconds at the start and end of the recording.
- Pull two stills (one of Ashley, one of the guest) in Photoshop /
  Photopea / Affinity.
- Composite side-by-side on a clean warm background. Match exposure.
- Add a thin border or vignette if needed.

### Option B: Adobe Express / Firefly compose
- Use the contributor portraits (when commissioned) as the source.
- Compose into a 1600×900 frame with the show wordmark in a corner.
- Faster but less personal than Option A.

### Option C: Photographer for live recordings
- For the Wagon Box America 250 / Luma 2026 in-person recordings,
  budget a one-day photographer to capture both establishing two-shots
  AND quote-card pull-shots.

## Frontmatter fields added in this PR

| Field | Required? | Notes |
|---|---|---|
| `heroImage` | No | Path to the hero image (relative to site base). When omitted, episode page shows a typographic placeholder. |
| `heroImageCredit` | No | Photo credit caption shown beneath the hero. |
| `subtitle` | No | One-line italic framing displayed below the title. Falls back to the first sentence of `summary` if omitted. |
