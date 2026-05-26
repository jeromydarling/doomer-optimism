#!/usr/bin/env python3
"""
scripts/transcribe-whisperx.py

Local WhisperX transcription for the Doomer Optimism back catalog.

Populates the .transcripts/ cache with {shortHash(guid)}.scribe.json
files in the same shape ElevenLabs Scribe produces. The existing
backfill-transcripts.yml workflow then picks up the cached transcripts
and runs Haiku enrichment + MDX writes — zero Scribe credits burned.

Setup (one time, on a CUDA box):
  python -m venv .venv && source .venv/bin/activate
  pip install -U pip
  pip install whisperx
  # Accept the gated model license:
  #   https://huggingface.co/pyannote/speaker-diarization-3.1
  # Then create a HuggingFace token at https://hf.co/settings/tokens
  export HF_TOKEN=hf_xxx

Usage:
  python scripts/transcribe-whisperx.py                 # transcribe all uncached
  python scripts/transcribe-whisperx.py --limit 5       # first 5 only
  python scripts/transcribe-whisperx.py --only 247      # episode #247
  python scripts/transcribe-whisperx.py --no-diarize    # skip pyannote
  python scripts/transcribe-whisperx.py --commit        # force-add + commit
                                                        # .transcripts/*.scribe.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".transcripts"
AUDIO = CACHE / "audio"
FEED_DEFAULT = "https://anchor.fm/s/68308b7c/podcast/rss"


def short_hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def fetch_rss(feed_url: str) -> list[dict]:
    print(f"▶ Fetching feed: {feed_url}", flush=True)
    with urllib.request.urlopen(feed_url) as r:
        xml = r.read()
    root = ET.fromstring(xml)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        guid = (it.findtext("guid") or title).strip()
        enc = it.find("enclosure")
        url = enc.get("url") if enc is not None else None
        if not url:
            continue
        m = re.match(r".*?#(\d+)\b", title)
        num = int(m.group(1)) if m else None
        items.append({"title": title, "guid": guid, "url": url, "number": num})
    return items


def download(url: str, dest: Path) -> None:
    print(f"  ↓ downloading enclosure", flush=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    tmp.rename(dest)


_WHISPERX_CACHE: dict = {}


def transcribe(audio_path: Path, model_name: str, diarize: bool, hf_token: str | None) -> dict:
    """Run WhisperX → return Scribe-shaped JSON: {words: [{text, speaker_id, start, end, type}]}"""
    import torch  # type: ignore
    import whisperx  # type: ignore

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    # Cache the loaded models so we don't pay re-load cost per episode.
    if "asr" not in _WHISPERX_CACHE:
        print(f"  ⚙ loading {model_name} on {device} (one-time)", flush=True)
        _WHISPERX_CACHE["asr"] = whisperx.load_model(
            model_name, device, compute_type=compute_type, language="en"
        )
    asr = _WHISPERX_CACHE["asr"]

    audio = whisperx.load_audio(str(audio_path))
    result = asr.transcribe(audio, batch_size=16, language="en")

    if "align" not in _WHISPERX_CACHE:
        print("  ⚙ loading alignment model (one-time)", flush=True)
        align_model, meta = whisperx.load_align_model(language_code="en", device=device)
        _WHISPERX_CACHE["align"] = (align_model, meta)
    align_model, meta = _WHISPERX_CACHE["align"]
    result = whisperx.align(
        result["segments"], align_model, meta, audio, device, return_char_alignments=False
    )

    if diarize:
        if "diarize" not in _WHISPERX_CACHE:
            print("  ⚙ loading diarization pipeline (one-time)", flush=True)
            _WHISPERX_CACHE["diarize"] = whisperx.DiarizationPipeline(
                use_auth_token=hf_token, device=device
            )
        diarizer = _WHISPERX_CACHE["diarize"]
        diarize_segments = diarizer(audio)
        result = whisperx.assign_word_speakers(diarize_segments, result)

    words: list[dict] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            text = (w.get("word") or "").strip()
            if not text:
                continue
            words.append(
                {
                    "text": text,
                    "speaker_id": w.get("speaker", "SPEAKER_00"),
                    "start": float(w.get("start") or 0),
                    "end": float(w.get("end") or 0),
                    "type": "word",
                }
            )
    return {"words": words}


def git_commit_transcripts(paths: list[Path]) -> None:
    if not paths:
        return
    rel = [str(p.relative_to(ROOT)) for p in paths]
    # .transcripts/ is gitignored; force-add the scribe.json files.
    subprocess.run(["git", "add", "-f", *rel], cwd=ROOT, check=True)
    msg = f"Local WhisperX transcripts: {len(paths)} episode(s)"
    res = subprocess.run(
        ["git", "commit", "-m", msg], cwd=ROOT, capture_output=True, text=True
    )
    if res.returncode != 0 and "nothing to commit" not in res.stdout + res.stderr:
        print(res.stdout, file=sys.stderr)
        print(res.stderr, file=sys.stderr)
        raise SystemExit("git commit failed")
    print(f"✓ committed {len(paths)} transcripts")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--feed", default=FEED_DEFAULT)
    ap.add_argument("--limit", type=int, default=0, help="cap how many uncached eps to do this run")
    ap.add_argument("--only", default=None, help="episode number or guid")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--no-diarize", action="store_true")
    ap.add_argument("--keep-audio", action="store_true", help="don't delete MP3 after transcription")
    ap.add_argument("--commit", action="store_true", help="git-commit each transcript as it lands")
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    AUDIO.mkdir(parents=True, exist_ok=True)

    hf_token = os.environ.get("HF_TOKEN")
    if not args.no_diarize and not hf_token:
        print(
            "HF_TOKEN is required for diarization.\n"
            "  1. Accept the model license at https://huggingface.co/pyannote/speaker-diarization-3.1\n"
            "  2. Create a token at https://hf.co/settings/tokens (read scope is fine)\n"
            "  3. export HF_TOKEN=hf_xxx",
            file=sys.stderr,
        )
        return 1

    items = fetch_rss(args.feed)
    if args.only:
        items = [it for it in items if str(it["number"]) == args.only or it["guid"] == args.only]

    pending = [
        it for it in items if not (CACHE / f"{short_hash(it['guid'])}.scribe.json").exists()
    ]
    if args.limit:
        pending = pending[: args.limit]

    print(f"  {len(items)} episodes in feed; {len(pending)} need transcription.\n", flush=True)
    if not pending:
        return 0

    ok = 0
    failed = 0
    committed_batch: list[Path] = []
    for i, it in enumerate(pending, 1):
        h = short_hash(it["guid"])
        tx_path = CACHE / f"{h}.scribe.json"
        url_no_q = it["url"].split("?", 1)[0]
        audio_ext = (url_no_q.rsplit(".", 1)[-1] if "." in url_no_q else "mp3").lower()
        audio_path = AUDIO / f"{h}.{audio_ext}"
        label = f"#{it['number']}" if it["number"] else h
        title_preview = (it["title"][:70] + "…") if len(it["title"]) > 70 else it["title"]
        print(f"[{i}/{len(pending)}] {label}: {title_preview}", flush=True)
        try:
            if not audio_path.exists():
                download(it["url"], audio_path)
            result = transcribe(audio_path, args.model, not args.no_diarize, hf_token)
            tx_path.write_text(json.dumps(result, indent=2))
            print(f"  ✓ {tx_path.name} ({len(result['words'])} words)", flush=True)
            if not args.keep_audio:
                audio_path.unlink(missing_ok=True)
            ok += 1
            if args.commit:
                committed_batch.append(tx_path)
                # commit every 5 to keep history readable but bounded
                if len(committed_batch) >= 5:
                    git_commit_transcripts(committed_batch)
                    committed_batch = []
        except KeyboardInterrupt:
            print("\nInterrupted.", file=sys.stderr)
            break
        except Exception as e:
            print(f"  ✗ failed: {e}", file=sys.stderr)
            failed += 1

    if args.commit and committed_batch:
        git_commit_transcripts(committed_batch)

    print(f"\nDone. {ok} ok, {failed} failed.")
    if args.commit:
        print("Next: `git push origin claude/transcripts-backfill` to trigger Haiku enrichment.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
