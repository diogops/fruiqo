#!/usr/bin/env bash
# Spike 01: YouTube oEmbed (endpoint público, sem autenticação)
# Fonte: https://www.youtube.com/oembed (formato oEmbed padrão, https://oembed.com/)
# Uso: GET simples, sem chave de API nem credenciais.
set -euo pipefail

VIDEO_URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
ENDPOINT="https://www.youtube.com/oembed?url=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$VIDEO_URL" 2>/dev/null || echo "$VIDEO_URL")&format=json"

echo "GET $ENDPOINT"
curl -s -o /tmp/spike01_body.json -w "HTTP_STATUS:%{http_code}\n" "$ENDPOINT"
echo "--- corpo (primeiras linhas) ---"
head -c 500 /tmp/spike01_body.json
echo
