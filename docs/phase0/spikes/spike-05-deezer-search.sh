#!/usr/bin/env bash
# Spike 05: Deezer API - busca pública (sem autenticação)
# Fonte: https://developers.deezer.com/api
set -euo pipefail

ENDPOINT="https://api.deezer.com/search?q=eminem"

echo "GET $ENDPOINT"
curl -s -o /tmp/spike05_body.json -w "HTTP_STATUS:%{http_code}\n" "$ENDPOINT"
echo "--- corpo (primeiras linhas) ---"
head -c 500 /tmp/spike05_body.json
echo
