# Local WhisperX transcription

For backfilling transcripts on your own GPU box instead of burning
ElevenLabs Scribe credits. Drops `.scribe.json` files into the same
cache the Scribe pipeline uses, so the existing Haiku-enrichment
workflow can pick them up unchanged.

## What you need

- NVIDIA GPU with CUDA 12.x (8 GB+ VRAM recommended for `large-v3`;
  drop to `medium` or `small.en` on smaller cards)
- Python 3.10–3.12
- ~12 GB free disk for model weights
- HuggingFace account + accepted license on
  https://huggingface.co/pyannote/speaker-diarization-3.1
  (free; takes 30 seconds — click "Agree and access repository")
- HuggingFace token from https://hf.co/settings/tokens (read scope)

## One-time install

```bash
git checkout claude/transcripts-backfill
git pull

python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -U pip
pip install whisperx

export HF_TOKEN=hf_xxx        # paste your token here
```

## Run

```bash
# Smoke test: one episode end-to-end (downloads ~50 MB audio,
# transcribes, writes .transcripts/<hash>.scribe.json)
python scripts/transcribe-whisperx.py --limit 1

# Inspect the output:
ls -lh .transcripts/*.scribe.json
head -50 .transcripts/*.scribe.json
```

If the smoke test produced a `.scribe.json` with reasonable text and
two speaker IDs (`SPEAKER_00` / `SPEAKER_01`), you're good.

## Full back catalog

```bash
# Transcribes every uncached episode in the feed (will run for hours;
# safe to ctrl-C and resume — cache is per-episode)
python scripts/transcribe-whisperx.py --commit
```

`--commit` force-adds each `.scribe.json` (the cache dir is gitignored
on main) and commits every 5 transcripts. When the run finishes:

```bash
git push origin claude/transcripts-backfill
```

That push doesn't auto-fire anything. To run Haiku enrichment + MDX
writes against the new transcripts, dispatch the existing workflow:

- GitHub → Actions → "Backfill transcripts" → Run workflow
  (or `gh workflow run backfill-transcripts.yml -r claude/transcripts-backfill`)

It will see the cached `.scribe.json` files, skip Scribe entirely, run
Haiku ($0.005/episode) on each transcript, write MDX, and open/update
the existing PR with the results.

## Performance ballpark

On a 3090/4090 with `large-v3`:
- ~15-25× real-time including diarization
- 1 hr episode → ~3-4 minutes
- 280 episodes × 60 min avg ≈ ~15 hours wall time, doable as 2 overnight runs

On a 2080 Ti or older 8 GB card, switch to `--model medium.en` —
slight quality drop, ~2× faster, fits comfortably in 8 GB.

## Flags

```
--limit N         transcribe only the first N uncached episodes
--only 247        transcribe just episode #247 (matches RSS title "#247 - ...")
--model NAME      large-v3 (default) | medium.en | small.en | base.en
--no-diarize      skip pyannote (no speaker labels; faster, no HF_TOKEN needed)
--keep-audio      don't delete MP3s after transcription
--commit          git-commit each batch of 5 transcripts as they land
```

## Troubleshooting

**"CUDA out of memory"**
Drop to a smaller model: `--model medium.en` or `--model small.en`.

**"401 Client Error" on diarization**
You haven't accepted the pyannote license — visit
https://huggingface.co/pyannote/speaker-diarization-3.1 and click
"Agree and access repository".

**Resume after crash**
Just rerun the same command. `.transcripts/<hash>.scribe.json` files
already on disk are skipped; only uncached episodes are processed.

**Wrong speakers (host called "B" / guest called "A")**
That's fine. The downstream pipeline (`transcribe-backfill.mjs`
→ `mapSpeakers`) detects Ashley via the show intro and remaps.
