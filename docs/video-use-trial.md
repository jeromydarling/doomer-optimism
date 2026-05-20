# video-use trial (Friday Riverside recording)

[video-use](https://github.com/browser-use/video-use) is an MIT-licensed,
Claude-Code-driven video editor (Browser Use, 2026). Same ElevenLabs Scribe
we already use for transcription, plus ffmpeg-based render with filler-word
cuts, audio fades, color grading, subtitle burning, and self-eval.

## Why we're trialling it

Adobe MCP's video tools (`video_create_quick_cut`, `media_enhance_speech`)
are session-bound to a Claude session and got blocked at the sandbox
firewall when we tested. The pipeline's `audio-enhance.mjs` and
`clip-cuts.mjs` stages are stubbed pass-throughs as a result. video-use is
ffmpeg-only locally + ElevenLabs over the network, which runs cleanly in
GHA. If the Friday trial output is acceptable, it replaces those stubs.

## Status (as of 2026-05-20)

- ✓ Installed at `~/Developer/video-use` in the dev sandbox
- ✓ Registered as a Claude Code skill via `~/.claude/skills/video-use`
- ✓ Python deps installed via `uv sync`
- ✓ `.env` contains `ELEVENLABS_API_KEY` (chmod 600)
- ✓ `ffmpeg` + `ffprobe` available on PATH
- ⚠ EL API blocked from this Claude Code sandbox (`Host not in allowlist`).
  The skill works fine on Ashley's local machine or in GHA — only this
  particular cloud sandbox has the egress restriction.

## Two paths for the trial

### Path A — Jeromy runs locally (fastest for Friday)

When Ashley uploads Friday's Riverside recording to Drive:

```bash
# One-time setup (Jeromy's machine)
git clone https://github.com/browser-use/video-use ~/Developer/video-use
cd ~/Developer/video-use
uv sync                                        # or: pip install -e .
echo "ELEVENLABS_API_KEY=<key>" > .env
chmod 600 .env
mkdir -p ~/.claude/skills
ln -sfn ~/Developer/video-use ~/.claude/skills/video-use

# Make sure ffmpeg is installed
brew install ffmpeg                            # macOS
# sudo apt-get install -y ffmpeg               # Ubuntu

# Per-recording (~10 min wall, ~$0.50 in EL credits for an hour-long ep)
mkdir -p ~/recordings/304-jasmine-mitchell
cd ~/recordings/304-jasmine-mitchell
# Drop Ashley's Riverside MP4 here (or use Drive desktop sync)
claude
# In the agent session:
# > "edit this into a launch video — cuts, subs, render to YouTube spec"
```

Outputs land in `<recordings>/304-jasmine-mitchell/edit/`. Review the
`final.mp4` + the EDL it produced. If the cuts are sensible, ship it.

### Path B — GHA pipeline (production path; future)

`.github/workflows/video-use-process.yml` (not yet built — sketch):

1. `workflow_dispatch` with `drive_file_id` input
2. Pull file from Drive via OAuth (we have the credentials)
3. `git clone https://github.com/browser-use/video-use /tmp/video-use`
4. `cd /tmp/video-use && uv sync`
5. Drop the file in a working dir, kick off the helpers in order:
   `transcribe.py → pack_transcripts.py → render.py`
6. Upload `final.mp4` as a workflow artifact (GH releases for longer
   retention) + post a summary with the cuts diff
7. Optionally: post a Buffer-ready clip + announce in /admin

This is the natural replacement for the audio-enhance + clip-cuts pipeline
stubs once we've validated the output quality on a real recording.

## What to evaluate Friday

When you see the rendered `final.mp4`, judge:

- **Are filler-word cuts inaudible?** 30ms audio fades should hide them.
  Listen specifically across each cut boundary.
- **Are timing pauses natural?** The "dead space between takes" removal
  shouldn't make Ashley sound rushed or interrupt her cadence.
- **Are subtitle chunks readable?** Default is 2-word UPPERCASE chunks.
  Adjust in SKILL.md if Ashley wants longer phrases or different casing.
- **Is the color grade subtle?** Auto-grade applies ffmpeg color chains;
  shouldn't over-saturate.
- **Self-eval pass?** The tool checks each cut boundary before delivering;
  failures get logged. Check the logs for anything it flagged.

## If quality is good

1. Wire it into the pipeline (replace `audio-enhance.mjs` + `clip-cuts.mjs`
   with `video-use` invocations in `orchestrator.mjs`)
2. Add a `.github/workflows/video-use-process.yml` workflow
3. Document Ashley's upload conventions (drop video into Drive subfolder,
   pipeline does the rest)

## If quality is iffy

- The tool exposes the EDL (cut list) — Ashley can review + edit before
  render. So it's not all-or-nothing.
- Specific failure modes (over-cut, awkward pauses, mis-detected fillers)
  can be addressed via the SKILL.md "production-correctness rules" Browser
  Use ships with.
- Fall back to manual editing in Premiere or DaVinci for the trial episode,
  retry video-use on next episode with adjusted rules.
