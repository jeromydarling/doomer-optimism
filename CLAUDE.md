# Doomer Optimism — site

Static site for the Doomer Optimism podcast (host: Ashley Colby Fitzgerald, co-founder Rizoma Field School). Deployed to GitHub Pages from the `claude/doomer-optimism-site-Ime4V` branch via GitHub Actions. The site is the **hub** in a hub-and-spoke distribution model — full episode archive, categorized research library, contributor pages, events, and the searchable bibliography across all episodes.

## Stack
- **Astro 5** (content collections + MDX), Tailwind CSS, `@fontsource` for self-hosted serif type
- **Pagefind** for client-side full-text search across episodes, transcripts, articles
- **GitHub Pages** via `.github/workflows/deploy.yml`
- Node 22 (`.nvmrc`)

## Commands
- `npm run dev` — Astro dev server (default <http://localhost:4321>)
- `npm run build` — Astro build + Pagefind index
- `npm run preview` — preview production build
- `npm run check` — Astro type-check

## Architecture
- `src/content/config.ts` — content collection schemas (episodes, pillars, contributors, articles, events)
- `src/content/episodes/*.mdx` — episode entries; one file per episode. Filename pattern: `{number}-{slug}.mdx`
- `src/content/pillars/*.md` — the six pillars (regenerative-ag, conservation, built-environment, tech/AI, right-to-repair, family/schooling)
- `src/content/contributors/*.md` — host + lead voices + recurring guests; portraits rendered as procedurally-generated WSJ-hedcut placeholders until commissioned art arrives
- `src/content/articles/*.mdx` — companion essays (1,500–2,500 words), paired to an episode via the `episode` reference
- `src/content/events/*.md` — annual gatherings, pilot recording series
- `src/lib/site.ts` — site metadata, `withBase()` URL helper, formatting helpers
- `src/components/HedcutPlaceholder.astro` — deterministic procedural portrait used as commissioned-art placeholder

## Aesthetic constraints
- "Beautiful and ancient": parchment ground, deep umber ink, terracotta + moss + oxblood accents
- Display: **Cormorant Garamond**. Body: **EB Garamond**. Tiny labels: **Inter** (sparingly, small caps)
- No rounded corners on cards; hairline rules; generous margins; drop caps on long-form
- Mobile-first; the design must hold up at 375px width

## Editorial conventions
- Never invent quotes attributed to real people. Episode summaries describe topics, not specific claims.
- Bibliography entries should be real, verifiable works. If unsure, leave a TODO comment in the file.
- Transcripts are real or absent — placeholder copy in the page handles the "coming soon" state.

## Adding an episode
1. Create `src/content/episodes/{number}-{guest-slug}.mdx` matching the schema in `src/content/config.ts`.
2. The `pillar` field is a `reference('pillars')` — use the pillar's filename slug (e.g., `regenerative-agriculture`).
3. If the guest has a contributor page, set `guestSlug` to the contributor's filename slug.
4. Bibliography is an array of `{ title, author?, year?, href?, kind }`.
5. Push to `claude/doomer-optimism-site-Ime4V` — Actions builds and deploys to Pages.

## RSS ingestion (future)
The schema is RSS-ready. When the real Doomer Optimism feed URL is in hand, add a script `scripts/import-rss.mjs` that fetches the feed, transforms each `<item>` into an MDX file under `src/content/episodes/`, and either commits or PRs the result. The file format is intentionally flat to make this trivial.

## Transcripts pipeline (live)
- `scripts/transcribe-backfill.mjs` — pulls the YouTube channel via yt-dlp, transcribes via **ElevenLabs Scribe** (with diarization), then enriches each transcript via **Claude Haiku 4.5** (chapters, key topics, bibliography, suggested pillar, summary, pull quotes). Writes MDX preserving curated frontmatter.
- `.github/workflows/backfill-transcripts.yml` — `workflow_dispatch` action that runs the backfill in CI and opens a PR with the results.
- Requires `ELEVENLABS_API_KEY` and `ANTHROPIC_API_KEY` repo secrets.
- Caches per-video JSON in `.transcripts/` and per-video enrichment in `.transcripts/enriched/` so reruns are cheap.
- Speaker mapping: longest cumulative talker → host (Ashley); second-longest → guest extracted from title; rest are `Speaker C/D/...` for human review.
- New episodes land with `draft: true` — review-then-publish flow.

## CMS layer (future)
Static content collections support adding a Git-based admin UI later (Decap CMS / Sveltia CMS) so guest writers can author companion essays without touching the repo. The static deploy stays unchanged — the CMS commits markdown back to this same tree.

## Don't
- Don't add backwards-compatibility shims. We're pre-launch; just change the code.
- Don't write planning/decision docs to disk unless asked.
- Don't push to `main` from claude — work happens on `claude/doomer-optimism-site-Ime4V`.
