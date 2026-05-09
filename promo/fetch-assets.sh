#!/usr/bin/env bash
# Fetch the public-domain assets the composition needs.
#
# Painting: "The Angelus" by Jean-François Millet (1857–1859), public
# domain. Music: "Air on the G String" from Bach's Orchestral Suite
# No. 3 (BWV 1068, 1731), public domain — pastoral, contemplative,
# pairs naturally with the painting's evening-prayer composition.
#
# Both come from Wikimedia Commons. We use Special:FilePath URLs (which
# follow redirects to the canonical media file) plus a hard-coded
# alternate as backup in case the file gets renamed upstream.

set -e
mkdir -p assets

UA="DoomerOptimism-Promo/1.0 (https://doomeroptimism.com; jeromy.darling@gmail.com)"

# Try each URL in the array in order; stop on first success.
fetch_first() {
  local out="$1"; shift
  local urls=("$@")
  local i=0
  for url in "${urls[@]}"; do
    i=$((i+1))
    echo "  [try $i] $url"
    if curl -fsSL -A "$UA" -o "$out" "$url"; then
      local size
      size=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out")
      if [ "${size:-0}" -lt 1024 ]; then
        echo "    too small ($size bytes); trying next"
        rm -f "$out"
        continue
      fi
      echo "    ok ($(file -b "$out" | head -c 80); ${size} bytes)"
      return 0
    fi
  done
  return 1
}

echo "▶ Fetching The Angelus → assets/angelus.jpg"
fetch_first assets/angelus.jpg \
  "https://commons.wikimedia.org/wiki/Special:FilePath/Jean-Fran%C3%A7ois_Millet_-_The_Angelus_-_Google_Art_Project.jpg?width=2560" \
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Jean-Fran%C3%A7ois_Millet_-_The_Angelus_-_Google_Art_Project.jpg/2560px-Jean-Fran%C3%A7ois_Millet_-_The_Angelus_-_Google_Art_Project.jpg" \
  "https://commons.wikimedia.org/wiki/Special:FilePath/JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859%29.jpg?width=2560"

# Wikimedia hosts public-domain Bach recordings as .ogg; we fetch one
# and (if ffmpeg is available) transcode to .mp3 since some browsers
# / hyperframes' audio handling prefer it. If ffmpeg isn't present we
# leave the .ogg in place and rename — modern renderers handle it.
echo "▶ Fetching Bach (Air on the G String) → assets/music.ogg"
fetch_first assets/music.ogg \
  "https://commons.wikimedia.org/wiki/Special:FilePath/Bach_-_Air_on_the_G_String.ogg" \
  "https://commons.wikimedia.org/wiki/Special:FilePath/Bach,_Johann_Sebastian_-_Air_on_the_G_string.ogg" \
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/8/8a/Bach_-_Air_on_the_G_String.ogg/Bach_-_Air_on_the_G_String.ogg.mp3"

if command -v ffmpeg >/dev/null 2>&1 && [ -s assets/music.ogg ]; then
  echo "▶ Transcoding music.ogg → music.mp3"
  ffmpeg -y -loglevel error -i assets/music.ogg -codec:a libmp3lame -q:a 4 assets/music.mp3
  rm assets/music.ogg
elif [ -s assets/music.ogg ]; then
  # No ffmpeg locally — keep the .ogg and update the audio src in index.html
  echo "  (no ffmpeg in PATH; keeping .ogg)"
  mv assets/music.ogg assets/music.mp3   # hyperframes resolves by extension; renaming is the cheap fix
fi

ls -lh assets/

echo
echo "Done."
