# Doomer Optimism — site

Static site for the Doomer Optimism podcast (host: Ashley Colby Fitzgerald, co-founder Rizoma Field School). Deployed to GitHub Pages from `main` via GitHub Actions. The site is the **hub** in a hub-and-spoke distribution model — full episode archive, categorized research library, contributor pages, events, and the searchable bibliography across all episodes.

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
4. Bibliography is an array of `{ title, author?, year?, href?, isbn?, kind }`.
5. Push to `main` — Actions builds and deploys to Pages.

## RSS ingestion (future)
The schema is RSS-ready. When the real Doomer Optimism feed URL is in hand, add a script `scripts/import-rss.mjs` that fetches the feed, transforms each `<item>` into an MDX file under `src/content/episodes/`, and either commits or PRs the result. The file format is intentionally flat to make this trivial.

## Transcripts pipeline (live)
- `scripts/transcribe-backfill.mjs` — pulls the Anchor RSS feed, transcribes via **ElevenLabs Scribe** (with diarization), then enriches each transcript via **Claude Haiku 4.5** (chapters, key topics, bibliography, suggested pillar, summary, pull quotes). Writes MDX preserving curated frontmatter.
- `.github/workflows/backfill-transcripts.yml` — `workflow_dispatch` action that runs the backfill in CI and opens a PR with the results.
- Requires `ELEVENLABS_API_KEY` and `ANTHROPIC_API_KEY` repo secrets.
- Caches per-video JSON in `.transcripts/` and per-video enrichment in `.transcripts/enriched/` so reruns are cheap. Caches live on the `claude/transcripts-backfill` PR branch (durable; not on main).
- Speaker mapping: show-intro detection ("welcome to Doomer Optimism") to identify Ashley; longest non-host talker is the guest. Falls back to longest-talker = host if no intro pattern matches.
- New episodes land with `draft: true` — review-then-publish flow.

### Auto-watcher for new episodes
- `.github/workflows/watch-new-episodes.yml` — cron-triggered (every 4 hours). Detects when a new episode appears in the Anchor RSS feed, runs the transcript pipeline for just that one episode (`--limit-new=1`), and opens/updates the same PR.
- `scripts/detect-new-episode.mjs` — cheap probe; prints `new=true` when the most recent RSS item isn't yet cached in `.transcripts/`.
- `scripts/match-youtube.mjs` — fetches the YouTube channel's RSS feed and fuzzy-matches by title to fill in `youtubeId` for any recent episode missing one. Idempotent; runs every cron tick so episodes whose YouTube upload lags the podcast still get matched eventually.
  - Requires the **`YOUTUBE_CHANNEL_ID`** repo *variable* (not a secret) — find it by viewing source on the channel page and searching for `"channelId":"UC…"`. Without it, the matcher silently skips and only the transcript half runs.
- Threshold for accepting a match is Jaccard ≥ 0.55 on title word tokens (after stripping show prefixes like "Doomer Optimism #N -"). Misses are logged for manual review rather than guessed.

## The Annual (Lulu print pipeline)
- `src/pages/annual/[year].astro` — printable interior. Open in Chrome → Print → Save as PDF (6×9 in) → drop into `public/annual/{year}/interior.pdf`.
- `src/pages/annual/[year]/cover.astro` — printable front + spine + back cover spread. Default spine width is 0.5" (~150 page book on 60# cream); adjust the `SPINE_INCHES` constant after the final page count is known. Print → custom paper size matching the rendered dimensions → save as `public/annual/{year}/cover.pdf`.
- After committing both PDFs the static deploy publishes them at public URLs Lulu can fetch.
- `scripts/lulu-submit.mjs` — OAuth2 + Lulu Print API client. Submits the print job referencing the published PDFs. Requires `LULU_CLIENT_KEY` (and optionally `LULU_CLIENT_SECRET`) env vars; pass `--sandbox` to use Lulu's test environment.
- The default POD package is 6×9 paperback B&W cream (`0600X0900BWSTDPB060UW444MXX`). Override via `--pod-package-id` for hardcover or premium colour variants.

## Bookshop.org affiliate
- Set `BOOKSHOP_AFFILIATE_ID` in the build env (or in `.env`) to route every bibliography book link through your Bookshop affiliate ID.
- Bibliography entries take an optional `isbn` field. When present, books render as Bookshop affiliate links; otherwise they fall back to any explicit `href`, or plain italic text.
- Component: `src/components/BibliographyLink.astro` — used by the episode detail page, library page, and the Annual.

## Claude-as-CMS (the actual model)

There is no admin UI. **Ashley is not a developer and will not open
GitHub.** She talks to Claude Code on the web and Claude does
everything: editing MDX, committing, triggering CI, pulling release
artifacts back, and delivering files via the Gmail MCP if needed.

When Claude picks up a task in a future session, the heuristic is:
- Is the human writing in plain English about something they want
  done (a new article, a promo, an event, an email blast)? → Don't
  send them to GitHub. Just do it.
- Is the human writing technical/dev requests? → That's me (Jeromy)
  setting up infrastructure. Treat as code review.

Concretely, the patterns Claude should drive end-to-end:
- **New article** — write the MDX under `src/content/articles/`,
  commit, push to main; Pages auto-deploys.
- **New episode (manual)** — only if the auto-watcher missed it.
  Same pattern.
- **Promo video** — edit `promo/index.html`, commit, push; the
  render workflow auto-fires; poll `latest-promo` release for the
  MP4; deliver the URL.
- **Event creation** — write the MDX under `src/content/events/`,
  commit, push.
- **Attendee email blast** *(once Stripe + Gmail are wired)* —
  query Stripe for the event's customers, draft the email, send
  via Gmail MCP after she approves.

## Don't
- Don't add backwards-compatibility shims. We're pre-launch; just change the code.
- Don't write planning/decision docs to disk unless asked.
