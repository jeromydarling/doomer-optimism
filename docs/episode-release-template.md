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

## Producing the hero image — Ashley-uploads-pile workflow

Ashley collects 2+ photos per episode (headshots of host + guest, screenshots from the Zoom recording, a wide room shot, whatever's usable) into a per-episode subfolder on the shared Drive. The pipeline stitches them into a 1600×900 hero automatically.

### The script

`scripts/compose-hero-from-images.mjs <slug> <image1> [image2] [--mode=single|side-by-side]`

Two compose modes:

- **side-by-side** (default when 2+ images): two 800×900 panels. Best when each image is a headshot of one person.
- **single** (default when 1 image): one image cover-fitted across the whole 1600×900 frame, parchment-tinted eyebrow at top with the episode number. Best when Ashley uploads a single wide two-shot from the recording.

Both modes add a thin border, terracotta center divider (side-by-side), and the show wordmark. Output: `public/episodes/heroes/{slug}.jpg`.

Example:
```bash
node scripts/compose-hero-from-images.mjs 304-gord-magill-right-to-repair \
  /tmp/drive/ep-304/ashley.jpg /tmp/drive/ep-304/gord.jpg
```

### Drive folder convention (for the full auto-pipeline)

```
Doomer Optimism Episodes/
├── ep-304-gord-magill/
│   ├── recording.m4a            (existing — picked up by transcribe pipeline)
│   └── images/                  (new — picked up by hero composer)
│       ├── host.jpg
│       └── guest.jpg
```

When the pipeline runs (`pipeline-process.yml`), the hero compose stage:
1. Pulls `images/*.{jpg,png}` from the episode's Drive subfolder
2. Runs `compose-hero-from-images.mjs` with detected files
3. Commits the resulting JPG + sets `heroImage:` in the MDX frontmatter

### Source image quality tips for Ashley

- **Two clean headshots** is usually best. Each should have the person centered, well-lit, eyes at roughly the same vertical position in the frame.
- **Or one wide two-shot** if you grabbed one good still from the Zoom recording — use `--mode=single`.
- **JPEG or PNG** both fine. Any aspect ratio (the composer crops/fits).
- **Avoid:** YouTube thumbnails (low resolution, weird crops), screenshots of speaker tiles, anything with watermarks/UI chrome.

### v2 enhancements (separate PR)

- Adobe MCP `image_remove_background` on each source before composite → cleaner cutout-style heroes where people float on the parchment background
- Adobe MCP `image_select_by_prompt` to auto-pick "the person on the right" / face detection if Ashley uploads a chaotic pile
- Live-recording photography for in-person events (Wagon Box, Luma 2026)

## Frontmatter fields added in this PR

| Field | Required? | Notes |
|---|---|---|
| `heroImage` | No | Path to the hero image (relative to site base). When omitted, episode page shows a typographic placeholder. |
| `heroImageCredit` | No | Photo credit caption shown beneath the hero. |
| `subtitle` | No | One-line italic framing displayed below the title. Falls back to the first sentence of `summary` if omitted. |
