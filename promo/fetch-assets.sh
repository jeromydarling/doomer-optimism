#!/usr/bin/env bash
# Fetch the public-domain assets the composition needs. Run this once
# before `npm run check` / `npm run render`.
#
# Painting: "The Angelus" by Jean-François Millet (1857–1859), in the
# public domain since long before any copyright treaty. Sourced from
# Wikimedia Commons.
#
# Music: "Sheep May Safely Graze" (Schafe können sicher weiden) from
# Bach's Cantata BWV 208 — pastoral, devotional, an ideal companion to
# the painting's evening-prayer composition. Recording is by the
# Advent Chamber Orchestra, released into the public domain via
# Musopen and mirrored on archive.org.
#
# Both URLs return 403 from some hosts (CDNs, sandboxed IPs); if a
# fetch fails, swap in an equivalent file from your own machine and
# the composition picks it up unchanged.

set -e
mkdir -p assets

PAINTING_URL="https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859%29.jpg/2880px-JEAN-FRAN%C3%87OIS_MILLET_-_El_%C3%81ngelus_%28Museo_de_Orsay%2C_1857-1859%29.jpg"

# Bach BWV 208 — "Sheep May Safely Graze", Advent Chamber Orchestra recording
# (public domain via Musopen).
MUSIC_URL="https://archive.org/download/AdventChamberOrchestra-BachOrchestralSuite3InDMajor-Air/AdventChamberOrchestra-BachOrchestralSuite3InDMajor-Air.mp3"

UA="Mozilla/5.0 (compatible; DoomerOptimism-Promo/1.0)"

echo "▶ Fetching The Angelus to assets/angelus.jpg"
curl -fsSL -A "$UA" -o assets/angelus.jpg "$PAINTING_URL"
echo "  $(file -b assets/angelus.jpg | head -c 80)"

echo "▶ Fetching music to assets/music.mp3"
curl -fsSL -A "$UA" -o assets/music.mp3 "$MUSIC_URL"
echo "  $(file -b assets/music.mp3 | head -c 80)"

echo
echo "Done. Now: npm run check && npm run render"
