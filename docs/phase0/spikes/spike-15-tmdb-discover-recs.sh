#!/usr/bin/env bash
# SPIKE-15/16/17/18 — TMDB discover/keyword/recommendations/similar/watch-providers
# Le a TMDB_API_KEY (Bearer v4) de apps/api/.env SEM imprimir o valor.
# Nao grava nenhuma resposta bruta em fixtures/; so resume status/campos no log de spikes.
set -euo pipefail

ENV_FILE="apps/api/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ENV_FILE nao encontrado: $ENV_FILE"
  exit 1
fi

TMDB_API_KEY="$(grep -E '^TMDB_API_KEY=' "$ENV_FILE" | head -n1 | cut -d'=' -f2-)"
if [ -z "$TMDB_API_KEY" ]; then
  echo "TMDB_API_KEY vazio em $ENV_FILE"
  exit 1
fi

BASE="https://api.themoviedb.org/3"
AUTH="Authorization: Bearer $TMDB_API_KEY"

echo "=== 1) discover/movie: with_genres=35,10749 (comedy+romance) watch_region=BR with_watch_providers=8 with_runtime.lte=140 ==="
curl -s -o /tmp/tmdb_discover.json -w "HTTP %{http_code}\n" -H "$AUTH" \
  "$BASE/discover/movie?with_genres=35,10749&watch_region=BR&with_watch_providers=8&with_runtime.lte=140&sort_by=popularity.desc&language=pt-BR"
echo "total_results: $(grep -o '"total_results":[0-9]*' /tmp/tmdb_discover.json | head -1)"
echo "primeiros titulos:"
grep -o '"title":"[^"]*"' /tmp/tmdb_discover.json | head -5

echo
echo "=== 2) search/keyword: query=romantic comedy ==="
curl -s -o /tmp/tmdb_keyword.json -w "HTTP %{http_code}\n" -H "$AUTH" \
  "$BASE/search/keyword?query=romantic%20comedy"
echo "resultados:"
grep -o '"id":[0-9]*,"name":"[^"]*"' /tmp/tmdb_keyword.json | head -5

echo
echo "=== 3) discover/movie com with_keywords (id da keyword 'romantic comedy' se encontrada) ==="
KEYWORD_ID="$(grep -o '"id":[0-9]*,"name":"[Rr]omantic [Cc]omedy"' /tmp/tmdb_keyword.json | grep -o '[0-9]*' | head -1)"
echo "keyword_id encontrado: ${KEYWORD_ID:-<nenhum>}"
if [ -n "${KEYWORD_ID:-}" ]; then
  curl -s -o /tmp/tmdb_discover_kw.json -w "HTTP %{http_code}\n" -H "$AUTH" \
    "$BASE/discover/movie?with_keywords=$KEYWORD_ID&sort_by=popularity.desc"
  echo "total_results com keyword: $(grep -o '"total_results":[0-9]*' /tmp/tmdb_discover_kw.json | head -1)"
fi

echo
echo "=== 4) movie/550/recommendations (Fight Club) ==="
curl -s -o /tmp/tmdb_recs.json -w "HTTP %{http_code}\n" -H "$AUTH" \
  "$BASE/movie/550/recommendations?language=pt-BR&page=1"
echo "total_results: $(grep -o '"total_results":[0-9]*' /tmp/tmdb_recs.json | head -1)"

echo
echo "=== 5) movie/550/similar ==="
curl -s -o /tmp/tmdb_similar.json -w "HTTP %{http_code}\n" -H "$AUTH" \
  "$BASE/movie/550/similar?language=pt-BR&page=1"
echo "total_results: $(grep -o '"total_results":[0-9]*' /tmp/tmdb_similar.json | head -1)"

echo
echo "=== 6) watch/providers/movie?watch_region=BR ==="
curl -s -o /tmp/tmdb_wp.json -w "HTTP %{http_code}\n" -H "$AUTH" \
  "$BASE/watch/providers/movie?watch_region=BR"
echo "qtd providers listados: $(grep -o '"provider_id"' /tmp/tmdb_wp.json | wc -l)"

echo
echo "=== 7) discover/tv equivalente (with_genres=35 tv, watch_region=BR) ==="
curl -s -o /tmp/tmdb_discover_tv.json -w "HTTP %{http_code}\n" -H "$AUTH" \
  "$BASE/discover/tv?with_genres=35&watch_region=BR&with_watch_providers=8&sort_by=popularity.desc&language=pt-BR"
echo "total_results: $(grep -o '"total_results":[0-9]*' /tmp/tmdb_discover_tv.json | head -1)"

echo
echo "=== 8) headers de rate limit (se houver) na resposta do discover ==="
curl -s -D - -o /dev/null -H "$AUTH" "$BASE/discover/movie?page=1" | grep -i -E "ratelimit|retry-after|x-" || echo "nenhum header de rate limit encontrado"

rm -f /tmp/tmdb_discover.json /tmp/tmdb_keyword.json /tmp/tmdb_discover_kw.json /tmp/tmdb_recs.json /tmp/tmdb_similar.json /tmp/tmdb_wp.json /tmp/tmdb_discover_tv.json
