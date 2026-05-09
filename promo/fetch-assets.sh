#!/usr/bin/env bash
# Fetch the public-domain assets the composition needs.
#
# Painting: "The Angelus" by Jean-François Millet (1857–1859), public
# domain, fetched from Wikimedia Commons via Special:FilePath (the
# redirect-friendly path that survives upstream filename changes).
#
# Music: searched on archive.org's Musopen collection (CC0 / public
# domain classical recordings) and downloaded fresh. The query targets
# Bach's "Air on the G String" first; if nothing comes back we widen to
# any uplifting Baroque piece in the Musopen collection. The script
# resolves a real, verified URL each run rather than relying on
# hardcoded guesses, so it doesn't bit-rot when individual items
# get re-organized upstream.

set -e
mkdir -p assets

UA="DoomerOptimism-Promo/1.0 (https://doomeroptimism.com; jeromy.darling@gmail.com)"

# ---- Painting ------------------------------------------------------------

if [ -s assets/angelus.jpg ] && [ "$(stat -c%s assets/angelus.jpg 2>/dev/null || stat -f%z assets/angelus.jpg)" -gt 1024 ]; then
  echo "▶ Painting cached at assets/angelus.jpg — skipping fetch."
else
  echo "▶ Fetching The Angelus → assets/angelus.jpg"
  PAINTING_URLS=(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Jean-Fran%C3%A7ois_Millet_-_The_Angelus_-_Google_Art_Project.jpg?width=2560"
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Jean-Fran%C3%A7ois_Millet_-_The_Angelus_-_Google_Art_Project.jpg/2560px-Jean-Fran%C3%A7ois_Millet_-_The_Angelus_-_Google_Art_Project.jpg"
    "https://commons.wikimedia.org/wiki/Special:FilePath/JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859%29.jpg?width=2560"
  )
  for url in "${PAINTING_URLS[@]}"; do
    echo "  [try] $url"
    if curl -fsSL -A "$UA" -o assets/angelus.jpg "$url"; then
      size=$(stat -c%s assets/angelus.jpg 2>/dev/null || stat -f%z assets/angelus.jpg)
      if [ "${size:-0}" -gt 1024 ]; then
        echo "    ok ($(file -b assets/angelus.jpg | head -c 80); ${size} bytes)"
        break
      fi
      echo "    too small (${size} bytes); trying next"
      rm -f assets/angelus.jpg
    fi
  done
  if [ ! -s assets/angelus.jpg ]; then
    echo "ERROR: could not fetch painting from any of the candidate URLs." >&2
    exit 1
  fi
fi

# ---- Music ---------------------------------------------------------------

if [ -s assets/music.mp3 ] && [ "$(stat -c%s assets/music.mp3 2>/dev/null || stat -f%z assets/music.mp3)" -gt 1024 ]; then
  echo "▶ Music cached at assets/music.mp3 — skipping fetch."
  exit 0
fi

# Search archive.org for any uplifting public-domain Baroque/classical
# audio. We don't constrain to a specific collection because the
# "musopen" tag isn't applied uniformly — broad mediatype:audio queries
# return more results. Pieces are ordered from "most pastoral" to
# "still works for the painting" so we get something reasonable even
# when an upstream item gets deleted.
QUERIES=(
  'title:(air on the g string) AND mediatype:(audio)'
  'title:(sheep may safely graze) AND mediatype:(audio)'
  'title:(jesu joy) AND creator:(bach) AND mediatype:(audio)'
  'title:(the lark ascending) AND mediatype:(audio)'
  'title:(canon in d) AND creator:(pachelbel) AND mediatype:(audio)'
  'title:(ave maria) AND creator:(schubert) AND mediatype:(audio)'
  'creator:(bach) AND format:(mp3) AND mediatype:(audio)'
  'creator:(bach) AND mediatype:(audio)'
  'creator:(vivaldi) AND mediatype:(audio)'
  'creator:(handel) AND mediatype:(audio)'
)

resolve_archive_org_mp3() {
  local query="$1"
  echo "  query: $query"
  # 1. Search for an item. Save the raw response so we can include
  # it in the diagnostic if parsing returns nothing.
  local search_url="https://archive.org/advancedsearch.php"
  local search_body="/tmp/_aosearch.json"
  curl -fsSL -A "$UA" -G \
    --data-urlencode "q=$query" \
    --data-urlencode "fl[]=identifier" \
    --data-urlencode "fl[]=title" \
    --data-urlencode "rows=5" \
    --data-urlencode "output=json" \
    -o "$search_body" \
    "$search_url" || { echo "    search request failed"; return 1; }

  # Print all candidates (for the CI log) and emit the first identifier
  # on its own line for the shell to read.
  local item
  item=$(python3 - "$search_body" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path) as f:
        d = json.load(f)
except Exception as e:
    print(f"  parse error: {e}", file=sys.stderr)
    sys.exit(0)
docs = d.get("response", {}).get("docs", [])
for x in docs:
    sys.stderr.write(f"    candidate: {x.get('identifier','?')}  {(x.get('title') or '?')[:80]}\n")
if docs:
    print(docs[0]["identifier"])
PY
  )

  if [ -z "$item" ]; then
    echo "    no items"
    echo "    raw response (first 300 chars): $(head -c 300 "$search_body")"
    return 1
  fi
  echo "    chosen: $item"

  # 2. Resolve a downloadable .mp3 inside that item.
  local meta_url="https://archive.org/metadata/$item"
  local file
  file=$(curl -fsSL -A "$UA" "$meta_url" \
    | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  files = d.get("files", [])
  # Prefer high-bitrate VBR MP3, then 128k, then any mp3.
  def score(f):
    name = (f.get("name") or "").lower()
    fmt = (f.get("format") or "").lower()
    if not name.endswith(".mp3"): return -1
    if "vbr" in fmt: return 30
    if "128" in fmt: return 20
    if "64" in fmt: return 5
    return 10
  ranked = sorted(files, key=score, reverse=True)
  good = next((f for f in ranked if (f.get("name") or "").lower().endswith(".mp3")), None)
  print(good["name"] if good else "")
except Exception:
  print("")
') || true
  if [ -z "$file" ]; then
    echo "    no mp3 in item"
    return 1
  fi
  echo "    file: $file"

  # 3. Download.
  local dl="https://archive.org/download/$item/$file"
  echo "    fetching: $dl"
  if ! curl -fsSL -A "$UA" -o assets/music.mp3 "$dl"; then
    return 1
  fi
  local size
  size=$(stat -c%s assets/music.mp3 2>/dev/null || stat -f%z assets/music.mp3)
  if [ "${size:-0}" -lt 100000 ]; then
    echo "    too small (${size} bytes)"
    rm -f assets/music.mp3
    return 1
  fi
  echo "    downloaded ($(file -b assets/music.mp3 | head -c 80); ${size} bytes)"

  # 4. Validate via ffprobe — confirm there's an audio stream and the
  # file is actually playable. Past renders have produced silent MP4s
  # because we accepted .mp3s that turned out to be empty/corrupt.
  if ! command -v ffprobe >/dev/null 2>&1; then
    echo "    (no ffprobe; skipping validation)"
    return 0
  fi
  local probe
  probe=$(ffprobe -v error -print_format json -show_format -show_streams assets/music.mp3 2>/dev/null || echo '{}')
  local has_audio duration_s
  has_audio=$(printf '%s' "$probe" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    streams = d.get("streams", [])
    print("yes" if any(s.get("codec_type") == "audio" for s in streams) else "no")
except Exception:
    print("no")
')
  duration_s=$(printf '%s' "$probe" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(int(float(d.get("format", {}).get("duration") or 0)))
except Exception:
    print(0)
')
  if [ "$has_audio" != "yes" ] || [ "${duration_s:-0}" -lt 30 ]; then
    echo "    rejected (audio_stream=$has_audio duration=${duration_s}s)"
    rm -f assets/music.mp3
    return 1
  fi
  echo "    validated (audio_stream=yes, duration=${duration_s}s)"
  return 0
}

echo "▶ Searching archive.org/Musopen for music"
for q in "${QUERIES[@]}"; do
  if resolve_archive_org_mp3 "$q"; then
    break
  fi
done

if [ ! -s assets/music.mp3 ]; then
  echo "ERROR: could not find a downloadable Musopen mp3 for any of the queries." >&2
  exit 1
fi

ls -lh assets/

echo
echo "Done."
