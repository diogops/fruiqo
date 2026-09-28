#!/usr/bin/env bash
# SPIKE-16 — Login social (RF-41), 2026-09-28
# Objetivo: confirmar que os endpoints públicos de descoberta/JWKS do Google e da Apple
# respondem sem autenticação, para uso na validação de ID token / identity token no backend.
# Só GET, sem credenciais, em endpoints oficiais documentados.
set -euo pipefail

echo "--- Google OIDC discovery document ---"
curl -sS -o /tmp/google_disc.json -w "HTTP %{http_code}\n" \
  "https://accounts.google.com/.well-known/openid-configuration"
grep -o '"jwks_uri": *"[^"]*"' /tmp/google_disc.json
grep -o '"issuer": *"[^"]*"' /tmp/google_disc.json
grep -o '"authorization_endpoint": *"[^"]*"' /tmp/google_disc.json
grep -o '"token_endpoint": *"[^"]*"' /tmp/google_disc.json

echo "--- Google JWKS (jwks_uri acima) ---"
curl -sS -o /tmp/google_jwks.json -w "HTTP %{http_code}\n" \
  "https://www.googleapis.com/oauth2/v3/certs"
head -c 200 /tmp/google_jwks.json; echo

echo "--- Apple JWKS (/auth/keys) ---"
curl -sS -o /tmp/apple_keys.json -w "HTTP %{http_code}\n" \
  "https://appleid.apple.com/auth/keys"
head -c 200 /tmp/apple_keys.json; echo

# Resultado observado em 2026-09-28 (sem gravar corpo bruto neste repositório):
#   Google discovery       -> HTTP 200; jwks_uri=https://www.googleapis.com/oauth2/v3/certs;
#                              issuer=https://accounts.google.com;
#                              authorization_endpoint=https://accounts.google.com/o/oauth2/v2/auth;
#                              token_endpoint=https://oauth2.googleapis.com/token
#   Google JWKS             -> HTTP 200; JSON { "keys": [...] } (RSA, uso "sig")
#   Apple JWKS (/auth/keys) -> HTTP 200; JSON { "keys": [...] } (RSA, alg RS256)
