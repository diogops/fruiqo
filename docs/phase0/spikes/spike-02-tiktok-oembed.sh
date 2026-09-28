#!/usr/bin/env bash
# Spike 02: TikTok oEmbed (endpoint público, sem autenticação)
# Fonte: https://developers.tiktok.com/docs/en/embed-videos
set -euo pipefail

TT_URL="https://www.tiktok.com/@scout2015/video/6718335390845095173"
ENDPOINT="https://www.tiktok.com/oembed?url=${TT_URL}"

echo "GET $ENDPOINT"
curl -s -o /tmp/spike02_body.json -w "HTTP_STATUS:%{http_code}\n" "$ENDPOINT"
echo "--- corpo (primeiras linhas) ---"
head -c 500 /tmp/spike02_body.json
echo
