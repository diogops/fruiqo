#!/usr/bin/env bash
# Spike 04: MusicBrainz API - busca de artista (sem autenticação, exige User-Agent)
# Fonte: https://musicbrainz.org/doc/MusicBrainz_API
# Regra: máximo 1 requisição/segundo por cliente.
set -euo pipefail

ENDPOINT="https://musicbrainz.org/ws/2/artist/?query=queen&fmt=json"
UA="Fruiqo-Phase0-Spike/0.1 (contato: ${MUSICBRAINZ_CONTACT:?defina MUSICBRAINZ_CONTACT com um e-mail de contato})"

echo "GET $ENDPOINT (User-Agent: $UA)"
curl -s -A "$UA" -o /tmp/spike04_body.json -w "HTTP_STATUS:%{http_code}\n" "$ENDPOINT"
echo "--- corpo (primeiras linhas) ---"
head -c 500 /tmp/spike04_body.json
echo
