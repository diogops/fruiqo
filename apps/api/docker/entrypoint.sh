#!/bin/sh
# Entrypoint da imagem de produção (api e worker).
# - api: prepara roles/RLS e aplica migrações (idempotente), depois sobe o HTTP
# - worker (FRUIQO_PROCESS=worker): só sobe o worker; nunca recebe a URL de admin
set -e

if [ "${FRUIQO_PROCESS:-api}" = "worker" ]; then
  unset DATABASE_URL_ADMIN FRUIQO_OWNER_PASSWORD
  echo "[entrypoint] iniciando worker"
  exec node dist/worker.js
fi

if [ "${SKIP_DB_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] SKIP_DB_MIGRATIONS=1 - pulando bootstrap/migrações"
else
  echo "[entrypoint] bootstrap do banco + migrações"
  node docker/bootstrap-db.mjs
fi

# credenciais de admin/owner não ficam no ambiente do processo HTTP
unset DATABASE_URL_ADMIN FRUIQO_OWNER_PASSWORD
echo "[entrypoint] iniciando api"
exec node dist/main.js
