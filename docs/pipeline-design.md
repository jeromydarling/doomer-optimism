# Episode pipeline — design & architecture

**Last updated:** 2026-05-10
**Author:** Claude (with Jeromy)

This document captures the architecture for the end-to-end episode publishing pipeline that takes Ashley's recorded Zoom file all the way to scheduled social posts. It exists because the transcripts-backfill workflow burned ~261k ElevenLabs credits hitting GitHub Actions' 6h cap with no recovery — every decision below is informed by that fiasco.

---

## 1. Principles (carved from yesterday's misses)

1. **Save before you spend.** Every paid API call is bracketed by a state checkpoint and a git push. Cap-kill must lose ≤1 episode of in-flight work.
2. **Pre-flight every paid call.** Check the credit/token balance against the projected cost _before_ the call. Refuse to start a step that can't fit.
3. **No `if: success()` on cleanup.** All "save what we have" steps run `if: always()`. That includes the artifact snapshot, the final state flush, and any PR/issue updates.
4. **Independent stages.** Each pipeline stage (ingest, audio-enhance, transcribe, enrich, cuts, graphic, queue) is its own job that reads/writes the state machine. A failure in stage N never re-runs stages 1…N-1.
5. **Idempotent stages.** Re-running a stage on the same episode is a no-op if its output already exists. State checks come first.
6. **Belt and suspenders.** The state machine is the source of truth, but we also snapshot raw assets to GitHub Releases (long retention) and to the `pipeline-state` branch (immediate, version-controlled).
7. **Budgets are guardrails, not warnings.** Hit a per-episode cost ceiling (default $10) → abort that episode and surface to /admin. Don't continue and hope.
8. **Webhooks over polling.** Zapier/Drive webhooks fire `repository_dispatch`. Polling burns Zapier tasks and adds latency.
9. **Manual override always available.** Every automated stage has a "skip and upload result manually via /admin" escape hatch.
10. **No silent fallbacks for paid stages.** If Adobe MCP fails on audio enhance, we don't quietly publish unprocessed audio — we surface to /admin and ask the human.

---

## 2. Platform limits & quotas

| Service | Free tier | Paid tier we'll use | Hard limits to design around |
|---|---|---|---|
| **GitHub Actions** | 2,000 min/mo private; unlimited public | Public repo (free) | **6h hard cap per job**; 5GB artifact storage; 10GB cache. ✓ verified by yesterday's fiasco. |
| **GitHub Pages** | 1GB site, 100GB/mo bandwidth | n/a | Static-only — no server-side code. ✓ verified. |
| **Google Drive API** | 1B requests/day, 1k req/100s/user | n/a | Shared folders count against owner only. Files >100MB trigger virus-scan interstitial on public share links — must use API for reliable downloads. ⚠ verified via docs, untested in our flow. |
| **Zapier** | 100 tasks/mo, 15-min polling | Starter ($30/mo, 750 tasks, 2-min polling) | One webhook = 1 task. Drive trigger polls every 15 min on free tier. ⚠ verify before relying on free. |
| **ElevenLabs Scribe v2** | n/a | Pay-per-use | ~3,000-3,500 credits per hour-long episode (verified). 25MB file size limit per request. ✓ verified. |
| **Anthropic API** | n/a | Pay-per-use | Rate limits per tier. Haiku 4.5 ~$0.005/episode for enrichment. ✓ verified. |
| **Adobe MCP (Express)** | Subscription-based | Whatever Ashley already has | Per-call timeouts (~5 min). Async jobs for video. ⚠ needs capability probe in readiness check. |
| **Canva API** | Pro+ required for API | If used | Skipping in v1; using Adobe MCP `image_*` instead. |
| **Buffer Essentials** | 3 channels, 10 queued posts/channel | $6/mo: unlimited posts, 1 user, 6 channels | Rate limit 60 req/min. Per-platform format limits enforced server-side. ⚠ verify queue-overflow behavior. |
| **YouTube** | Public uploads | n/a | Must be uploaded by the channel owner (Ashley) — Buffer can't upload videos to YouTube. Reels go elsewhere. ✓ verified. |
| **Instagram (via Buffer)** | Business account required | Reel must be ≤90s, ≤100MB, MP4 H.264 | Need IG Business + linked FB page. Buffer enforces. ⚠ verify Ashley has IG Business. |
| **Threads** | Available via Buffer | Text + image; video support via Reels API | New, less battle-tested. ⚠ verify Buffer support. |
| **X / Twitter** | Free posts via Buffer | Video ≤2:20, ≤512MB | Unlikely to hit limits at our clip size. ✓ verified. |
| **LinkedIn** | Personal vs Company page | Video ≤10min, ≤5GB | Pick Ashley's personal page. ✓ verified. |

**Confidence:** ✓ = verified in docs or by direct test. ⚠ = needs verification during readiness probe before first real run.

---

## 3. Decisions

| Question | Decision | Rationale |
|---|---|---|
| Approval gate UI | `/admin` page on the static site | Ashley never sees GitHub UI |
| `/admin` auth | GitHub OAuth (one-click) | Free, secure, no infra. Ashley clicks "Sign in with GitHub" once; never sees GH UI again |
| State persistence | Dedicated `pipeline-state` branch in this repo | Version-controlled, free, durable, doesn't pollute main |
| Episode discovery | Zapier (Drive trigger) → repo `repository_dispatch` → ingest workflow | Webhook-driven; no polling on our side |
| Drive folder model | Ashley shares a folder with Jeromy's Google account | Quota counts against Ashley only |
| Filename convention | `YYYY-MM-DD - Guest Name.{mp4,m4a,mov}` enforced by ingest stage | Ingest renames if drift detected; falls back to interactive /admin prompt if unparseable |
| Per-episode cost ceiling | $10 hard abort, $5 alert | Way above expected ~$0.50–1.00/ep. Anything higher = bug. |
| State machine schema | JSON file per episode in `pipeline-state` branch | Simple to read/write, diffable, recoverable |
| Social platforms | YouTube (manual by Ashley), Instagram, Threads, X, LinkedIn — **NOT TikTok** | User decision |
| Buffer plan | Essentials ($6/mo) | User decision; gets Reels, more channels |

---

## 4. Episode state machine

Each episode lives in `pipeline-state/episodes/{episode-id}.json` (on the `pipeline-state` branch). State transitions:

```
DRIVE_DETECTED        ← Zapier webhook fires repository_dispatch
  ↓
RAW_ARCHIVED          ← original file uploaded to GH release for permanence
  ↓
AUDIO_EXTRACTED       ← ffmpeg pulls audio track to .m4a
  ↓
SPEECH_ENHANCED       ← Adobe MCP media_enhance_speech (or skipped with note)
  ↓
TRANSCRIBED           ← Scribe v2 → .scribe.json (committed)
  ↓
ENRICHED              ← Haiku 4.5 → chapters/topics/biblio/summary/quotes
  ↓
MDX_WRITTEN           ← episode .mdx written to src/content/episodes/ (draft: true)
  ↓
CLIPS_CUT             ← Adobe MCP video_create_quick_cut → 3-5 vertical clips
  ↓
GRAPHIC_GENERATED     ← Adobe MCP image_* → 1080x1080 quote card
  ↓
ASSETS_BUNDLED        ← all media uploaded as GH release artifacts
  ↓
HUMAN_REVIEW          ← /admin shows queue card; Ashley clicks Approve or Edit
  ↓
BUFFER_QUEUED         ← scheduled posts created via Buffer API
  ↓
PUBLISHED             ← Buffer posts go live; site rebuilds with draft: false
```

**Recovery states:**
- `WAITING_FOR_BUDGET` — paid call refused; cron retries when balance restored
- `BLOCKED_NEEDS_HUMAN` — unrecoverable error; /admin shows red card with diagnostic
- `MANUAL_OVERRIDE` — human did the step outside the pipeline; mark complete

Each state record contains `{ state, lastTransitionAt, attempts, errors[], artifacts[], costSoFar }`.

---

## 5. Failure modes & fallbacks

| # | Failure | Likelihood | Fallback |
|---|---|---|---|
| 1 | GHA hits 6h cap | High (was the fiasco) | Per-stage workflows, each <30min; checkpoint after each paid call; `if: always()` artifact snapshot |
| 2 | Zapier free tier exhausted | Medium | Cron polling fallback in `pipeline-readiness.yml`; alert when <10 tasks left |
| 3 | Drive virus-scan interstitial on large file | Medium | Use Drive API direct download (bypasses interstitial); never use public share link |
| 4 | Drive OAuth token expired | High over time | Readiness probe verifies daily; alert email 7 days before refresh-token expiry |
| 5 | ElevenLabs balance insufficient | Low (top up monthly) | Pre-flight balance check + projection; transition to `WAITING_FOR_BUDGET`; cron retry |
| 6 | Anthropic balance insufficient | Medium (happened mid-fiasco) | Pre-flight check; **scribe.json saved BEFORE Haiku call** (so transcript not lost); transition to `WAITING_FOR_BUDGET` |
| 7 | Adobe MCP timeout on long video | High | 3 retries with exponential backoff; on final fail, transition to `MANUAL_OVERRIDE` and prompt Ashley in /admin |
| 8 | Adobe MCP rate-limited | Low | Backoff + retry; queue depth = 1 (single episode at a time) |
| 9 | Buffer queue full (Essentials = unlimited but rate-limited) | Low | Schedule with min 4h gaps; check existing queue before adding |
| 10 | Buffer OAuth expired | High over time | Daily readiness probe; auto-refresh if refresh token present; alert otherwise |
| 11 | YouTube Reel upload (not via Buffer) | N/A | Skip — Ashley uploads YT herself. Pipeline only builds the asset and surfaces in /admin for download |
| 12 | Ashley uploads file with non-conforming name | High | Ingest parses common patterns; on parse fail, /admin prompts her to fill in name/date/guest |
| 13 | Two episodes uploaded close together (race) | Medium | Concurrency group on `pipeline-process.yml`; queue serializes; state machine lock per episode |
| 14 | GHA runner disk pressure (large video) | Medium | Stream-process where possible; clean up `/tmp` after each stage; monitor disk in readiness |
| 15 | Webhook from Zapier fires twice | Low | Idempotency key on `repository_dispatch` event; state machine refuses re-init |
| 16 | Cost ceiling exceeded mid-episode | Low | Abort immediately; mark `BLOCKED_NEEDS_HUMAN`; surface diff between projection and actual |
| 17 | OAuth Apps don't allow callback to localhost in prod | Low | Configure both `localhost:4321` and `https://jeromydarling.github.io/doomer-optimism/admin` as callbacks |
| 18 | Pipeline-state branch grows unbounded | Low | Rotate completed episode files to `pipeline-state/archive/{year}/` after publish |
| 19 | GitHub OAuth scope creep / token leak | Low | Use a fine-grained PAT for the orchestrator with `repository_dispatch` write only; user OAuth for /admin reads only |
| 20 | Mid-stage failure leaves orphan files in `/tmp` | Medium | `if: always()` cleanup step in every workflow |

---

## 6. Budget guards

Every paid stage starts with:

```js
const balance = await checkBalance(provider);
const projection = projectCost(stage, episodeMetadata);
if (projection > balance * 0.95) {
  await setEpisodeState(episodeId, 'WAITING_FOR_BUDGET', {
    needs: projection,
    have: balance,
    provider,
  });
  await alertHuman(`Episode ${episodeId} blocked: needs ${projection}, have ${balance}`);
  process.exit(0); // not an error — a wait
}
```

Per-episode hard ceiling: **$10**. Track running cost in state file. Abort + mark `BLOCKED_NEEDS_HUMAN` if exceeded.

---

## 7. Cost ceilings (expected per episode)

| Stage | Expected | Ceiling |
|---|---|---|
| Drive download | $0 | n/a |
| Audio extract (ffmpeg, runner) | $0 | n/a |
| Audio enhance (Adobe MCP) | ~$0.10 | $0.50 |
| Transcribe (Scribe v2) | ~$0.30 (3,300 cred × $0.0001) | $1.00 |
| Enrich (Haiku 4.5) | ~$0.005 | $0.05 |
| Clips (Adobe MCP, ~3 cuts) | ~$0.15 | $0.75 |
| Graphic (Adobe MCP) | ~$0.05 | $0.25 |
| Buffer scheduling | $0 | n/a |
| **Total expected** | **~$0.60** | **$10 abort** |

---

## 8. Readiness probe (`pipeline-readiness.yml`)

Runs hourly (cron) and on push. Probes:

- ✓ ElevenLabs balance ≥ 10k credits (≈3 episodes)
- ✓ Anthropic balance ≥ $1
- ✓ Drive OAuth token valid (not expiring in <7 days)
- ✓ Buffer OAuth valid
- ✓ Adobe MCP responds to `adobe_mandatory_init`
- ✓ Zapier task count ≥ 5 remaining (free tier)
- ✓ ffmpeg available on runner
- ✓ `pipeline-state` branch exists and is writable
- ✓ `src/content/episodes/` writable
- ✓ Disk space on runner ≥ 10GB free

Outputs to `pipeline-state/readiness.json` (latest probe) and posts a status badge.

**Gate:** the pipeline workflow refuses to start (`needs: readiness-check`) unless the latest probe is green and <2h old. Stale probes block until a fresh one runs.

---

## 9. Required setup (manual one-time)

1. **GitHub OAuth App** — register at github.com/settings/developers. Client ID: lives in `src/lib/site.ts`. Authorize callback: `https://jeromydarling.github.io/doomer-optimism/admin/callback` (and `http://localhost:4321/doomer-optimism/admin/callback` for dev).
2. **Drive API** — Ashley creates a folder, shares with Jeromy's email (Editor). Jeromy auths once via Google's OAuth playground; refresh token stored as `GOOGLE_DRIVE_REFRESH_TOKEN` repo secret.
3. **Zapier zap** — trigger: Google Drive "New File in Folder". Action: Webhook POST to `https://api.github.com/repos/jeromydarling/doomer-optimism/dispatches` with bearer PAT (stored in Zapier's secret store) and event type `episode-detected`.
4. **Buffer** — Ashley signs up for Essentials, generates API token, store as `BUFFER_API_TOKEN` repo secret. Connects YT (manual export only), IG, Threads, X, LinkedIn.
5. **Adobe MCP** — already wired via Claude Code; the workflow inherits the MCP server from the running session. (TBD: how to invoke from headless GHA — may need an Adobe API token instead.)
6. **`pipeline-state` branch** — initialized on first push by `scripts/pipeline/init-state-branch.mjs`.

---

## 10. Open items / TBD

- **Adobe MCP from CI**: the MCP server is local to a Claude session. For CI runs we may need to either (a) use Adobe's REST API directly with a service account, or (b) call back into a Claude session via the SDK. **Default**: stub these stages and have Ashley do them manually via /admin "upload override" until we resolve.
- **Hostname for Pages site**: do we use a custom domain or stay on `jeromydarling.github.io/doomer-optimism/`? Affects OAuth callback URLs.
- **Email alerts**: use Gmail MCP from a separate alerting workflow that runs on `pipeline-state` branch pushes? Or use repo issues as the inbox?
