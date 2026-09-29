# Infra no Railway (produção)

Projeto Railway **fruiqo** (ambiente `production`), região **us-east4** (Virgínia), no mesmo padrão do ProcreditoWeb: imagem Docker multi-stage, usuário não-root, `tini`, migrações no entrypoint.

## Arquitetura

| Serviço | O que é | Rede |
|---|---|---|
| `api` | `apps/api/Dockerfile` com `FRUIQO_PROCESS=api`: bootstrap de roles + migrações, depois `dist/main.js` | Domínio público HTTPS gerado pelo Railway (`api-production-b3adf.up.railway.app`) |
| `worker` | Mesma imagem com `FRUIQO_PROCESS=worker`: só `dist/worker.js` (BullMQ + retenção) | Sem domínio público |
| `Postgres` | Plugin PostgreSQL | Só rede privada (`postgres.railway.internal`), **sem TCP proxy** |
| `Redis` | Plugin Redis | Só rede privada (`redis.railway.internal`), **sem TCP proxy** |

Build: `railway.toml` (raiz) + variável `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile` nos dois serviços. O contexto de build é a raiz do monorepo; `.railwayignore`/`.dockerignore` excluem `.env*`, `docs`, `fixtures-private`, `reports`, credenciais, `node_modules`, `dist` e artefatos mobile.

A imagem final (~300 MB) vem de `pnpm deploy --prod` da API: só dependências de produção da API e `@fruiqo/contracts`/`@fruiqo/taxonomy` compilados — nada de `apps/mobile`, `apps/web`, Expo/React Native ou devDependencies. Base fixada em `node:20-alpine`.

## Roles do Postgres (RLS)

| Role | Superusuário | BYPASSRLS | Uso |
|---|---|---|---|
| `postgres` | sim | sim | **Só** o bootstrap do entrypoint da `api` (via `DATABASE_URL_ADMIN`): cria/atualiza as roles e transfere ownership. Removida do ambiente do processo HTTP antes do `exec` |
| `fruiqo_owner` | não | não | Dono do database, do schema `public` e de todas as tabelas/sequências/funções; roda as migrações; gestão manual |
| `fruiqo_app` | não | não | Única role usada por `api` e `worker` em runtime; sujeita às policies de RLS |

`docker/bootstrap-db.mjs` é idempotente (roda a cada deploy da `api`). As tabelas têm `FORCE ROW LEVEL SECURITY`, que vale também para o `fruiqo_owner`; as funções `SECURITY DEFINER` (`auth_lookup_user`, purgas) funcionam porque as migrações 0001/0009/0010 criam policies `*_definer_*` restritas à role que roda a migração (= `fruiqo_owner`). **As migrações precisam sempre rodar como `fruiqo_owner`**, senão essas policies ficam atreladas à role errada.

### Conectar como `fruiqo_owner` para gestão

Postgres e Redis não têm acesso público. Opções, da mais segura para a menos:
1. **`railway ssh --service api`** (exige chave SSH registrada em `railway ssh keys add`) e, de dentro do container, `node` com `pg` usando a senha em `FRUIQO_OWNER_PASSWORD` — nada fica exposto na internet.
2. **TCP proxy temporário**: no dashboard, Postgres → Settings → Networking → *TCP Proxy* → gerar; conectar com `psql "postgresql://fruiqo_owner:<senha>@<proxy-host>:<porta>/railway"` (senha em Variables do serviço `api`); **remover o proxy logo depois** (`railway tcp-proxy list/delete --service Postgres`). Enquanto o proxy existir, o banco fica alcançável pela internet (protegido só pela senha).

Nunca use `postgres` para gestão do dia a dia.

## Variáveis (só nomes)

Comuns a `api` e `worker`: `NODE_ENV=production`, `PIPELINE_MODE=live`, `LOG_LEVEL`, `HOST`, `JWT_SECRET`, `FRUIQO_APP_PASSWORD`, `DATABASE_URL` (`fruiqo_app` via `${{Postgres.PGHOST}}`), `REDIS_URL` (`${{Redis.REDIS_URL}}?family=0`), `TMDB_API_KEY`, `OPENLIBRARY_CONTACT`, `TMDB_AI_CLEARANCE=confirmed`, `LLM_ENABLED=false`, `AI_MODE=rules`, `SANDBOX_ENABLED=false`, `REGISTRATION_ENABLED`, `ALLOWED_EMAILS`, `FRUIQO_PROCESS`, `RAILWAY_DOCKERFILE_PATH`.

Só na `api`: `DATABASE_URL_ADMIN` (`${{Postgres.DATABASE_URL}}`) e `FRUIQO_OWNER_PASSWORD`.

`WEB_ORIGIN`, `WEB_COOKIE_PATH` e `TRUST_PROXY_HOPS` só na `api` (ver "Sistema web"). Segredos são gerados e ficam **só** nas variáveis do Railway — nunca no repositório (que é público).

## Deploy

```bash
railway status                      # conferir projeto fruiqo / ambiente production
railway up --service api --detach   # a partir da RAIZ do repositório
railway up --service worker --detach
curl https://api-production-b3adf.up.railway.app/health
```

`railway up` envia o diretório atual (inclusive mudanças não commitadas, exceto o que está no `.gitignore`/`.railwayignore`): rode a partir de uma árvore limpa. Mudar uma variável (`railway variables --set`) já dispara um redeploy do serviço.

### Checklist de deploy

1. `git status` limpo e CI verde no commit (`gh run list --limit 1`).
2. `railway up --service api --detach` e `railway up --service worker --detach`; esperar `SUCCESS` em `railway deployment list --service <svc>`.
3. Logs da `api`: bootstrap das roles e migrações aplicadas, e **nenhuma** connection string impressa. Logs do `worker`: `worker iniciado` com `tmdb=true`.
4. `curl .../health` → 200 (Railway direto) e `curl https://fruiqo-web.vercel.app/api/health` → 200 (rewrite da Vercel).
5. Web: build com `MSYS_NO_PATHCONV=1` (ver "Publicar o web") e `grep -c "Program Files" dist/assets/*.js` = 0 antes de publicar.
6. Fumaça no navegador: login, catálogo, revisão e detalhe de um filme (onde assistir) em https://fruiqo-web.vercel.app.
7. Contas de teste: tirar o e-mail de QA do `ALLOWED_EMAILS` e apagar a conta (ver abaixo).

### Apagar uma conta

Pela própria conta: no web, Perfil → "Excluir minha conta"; no app, Ajustes → "Excluir minha conta". Ou direto na API: `DELETE /account` autenticado com o corpo `{"password": "<senha atual>", "confirm": "EXCLUIR"}` → 204 (senha errada 401, sem confirmação 400; rate limit de `AUTH_RATE_LIMIT_PER_MIN`). Na mesma transação apaga o usuário, e as FKs `ON DELETE CASCADE` levam todas as tabelas com `user_id` (sessões incluídas); jobs pendentes dele saem da fila `share-processing` e, no web, o cookie de refresh é limpo. Depois disso o login falha e, com o e-mail fora do `ALLOWED_EMAILS`, um novo cadastro é recusado (403).

Sem a senha da conta não há caminho pela API: o `fruiqo_owner` não enxerga `users` para DELETE (RLS FORCE sem policy para ele). Nesse caso, dentro do container (`railway ssh --service api`), `node` com `pg` em `DATABASE_URL` (`fruiqo_app`) e, na mesma transação, `select set_config('app.user_id', '<id>', true)` seguido de `delete from users where id = '<id>'`.

## Ligar a IA

Hoje: `AI_MODE=rules` e `LLM_ENABLED=false` (discover e humor funcionam por regras). A guarda D-07 já aceita IA com o TMDB ativo porque `TMDB_AI_CLEARANCE=confirmed` (D-20; evidência em `docs/phase0/tmdb-consulta-C15.md`). Para ligar:

1. Criar a chave em console.anthropic.com (com limite de gasto) e definir `ANTHROPIC_API_KEY` na `api` **e** no `worker` pelo dashboard ou `railway variables --set` — nunca no repositório nem em logs.
2. Na `api` e no `worker`: `AI_MODE=anthropic` e `LLM_ENABLED=true` (redeploy automático).
3. Conferir nos logs a subida sem erro da guarda D-07 e, no web, em Perfil, o consentimento de IA por usuário (SEC-CTRL-51): sem ele a conta continua em regras.
4. Testar "Como estou" com um texto livre e conferir que o interpretador é o LLM. Nenhum dado do TMDB, Spotify ou de capas vai ao LLM (ARB-REQ-06).
5. Para desligar: `LLM_ENABLED=false` (efeito imediato após o redeploy).

## Rollback

- Código: `railway deployment list --service api` e redeploy de um deployment anterior pelo dashboard (Deployments → ⋯ → Redeploy), ou `railway up` a partir do commit anterior.
- Banco: as migrações são só para frente; um rollback de código que dependa de schema antigo exige migração corretiva. Antes de migrações destrutivas, faça backup (Postgres → Backups no dashboard).
- Emergência: `railway down --service api` remove o deployment ativo.

## Pendências

- O `worker` não tem healthcheck HTTP (o `railway.toml` é compartilhado); a saúde dele aparece nos logs (`worker iniciado`, `retenção aplicada`).
- A `api` recebe `DATABASE_URL_ADMIN` como variável do serviço (necessário para o bootstrap); o processo HTTP não a herda, mas quem tem acesso ao serviço no Railway a vê.
- Região us-east4 é a mais próxima do Brasil disponível; dados ficam nos EUA (transferência internacional — PEND-10).

## Sistema web (Vercel, D-19)

- Produção: **https://fruiqo-web.vercel.app** (projeto `fruiqo-web`, escopo pessoal `diogo-daniel-pires-hitacarambis-projects`).
- O navegador fala só com o domínio da Vercel: `apps/web/vercel.json` reescreve `/api/*` para `https://api-production-b3adf.up.railway.app/*`. Assim o cookie de refresh é first-party (`SameSite=Strict`) e o `Path` é `/api/auth`.
- Variáveis da `api` ligadas a isso: `WEB_ORIGIN=https://fruiqo-web.vercel.app` (só https em produção, SEC-CTRL-49), `WEB_COOKIE_PATH=/api/auth`, `TRUST_PROXY_HOPS=1`.
- `TRUST_PROXY_HOPS=1` confia só no edge do Railway. Não some a Vercel: a API também é acessível direto pelo domínio do Railway (app mobile), e um 2º salto deixaria o cliente forjar o IP pelo `X-Forwarded-For`. Consequência: pelo web, o rate limit por IP enxerga o IP de saída da Vercel (o lockout por conta continua valendo).
- Cabeçalhos de segurança do web (CSP com hash do script de tema, `frame-ancestors 'none'`, HSTS, etc.) ficam no `vercel.json` (SEC-CTRL-48).

### Publicar o web

Deploy estático do build local (nada além do `dist` sobe para a Vercel):

```bash
cd apps/web
MSYS_NO_PATHCONV=1 VITE_API_URL=/api pnpm build   # no Git Bash, sem isso /api vira C:/Program Files/Git/api
grep -c "Program Files" dist/assets/*.js            # tem que dar 0
# pasta temporária com dist + vercel.json (sem .env*, sem .vercel de outro projeto)
mkdir -p /tmp/fruiqo-web && cp -r dist/. /tmp/fruiqo-web/ && cp vercel.json /tmp/fruiqo-web/
cd /tmp/fruiqo-web
vercel link --yes --project fruiqo-web --scope diogo-daniel-pires-hitacarambis-projects
rm -f .env.local   # o link cria um token OIDC; nunca publicar
vercel deploy --prod --yes
```

Se o script inline do `index.html` mudar, recalcule o hash SHA-256 e atualize o `script-src` do `vercel.json`, senão o tema não é aplicado antes da primeira pintura.
