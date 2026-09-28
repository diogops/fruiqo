#!/usr/bin/env bash
# Spike 03: Spotify oEmbed (endpoint público, sem autenticação)
# Fonte: https://developer.spotify.com/documentation/embeds/reference/oembed
set -euo pipefail

TRACK_URL="https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3"
ENDPOINT="https://open.spotify.com/oembed?url=${TRACK_URL}"

echo "GET $ENDPOINT"
curl -s -o /tmp/spike03_body.json -w "HTTP_STATUS:%{http_code}\n" "$ENDPOINT"
echo "--- corpo (primeiras linhas) ---"
head -c 500 /tmp/spike03_body.json
echo
