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

Comuns a `api` e `worker`: `NODE_ENV=production`, `PIPELINE_MODE=live`, `LOG_LEVEL`, `HOST`, `JWT_SECRET`, `FRUIQO_APP_PASSWORD`, `DATABASE_URL` (`fruiqo_app` via `${{Postgres.PGHOST}}`), `REDIS_URL` (`${{Redis.REDIS_URL}}?family=0`), `TMDB_API_KEY`, `TMDB_AI_CLEARANCE=pending`, `LLM_ENABLED=false`, `AI_MODE=rules`, `SANDBOX_ENABLED=false`, `REGISTRATION_ENABLED`, `ALLOWED_EMAILS`, `FRUIQO_PROCESS`, `RAILWAY_DOCKERFILE_PATH`.

Só na `api`: `DATABASE_URL_ADMIN` (`${{Postgres.DATABASE_URL}}`) e `FRUIQO_OWNER_PASSWORD`.

`WEB_ORIGIN` fica vazio até o sistema web ter um domínio HTTPS. Segredos são gerados e ficam **só** nas variáveis do Railway — nunca no repositório (que é público).

## Deploy

```bash
railway status                      # conferir projeto fruiqo / ambiente production
railway up --service api --detach   # a partir da RAIZ do repositório
railway up --service worker --detach
curl https://api-production-b3adf.up.railway.app/health
```

`railway up` envia o diretório atual (inclusive mudanças não commitadas, exceto o que está no `.gitignore`/`.railwayignore`): rode a partir de uma árvore limpa.

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
VITE_API_URL=/api pnpm build
# pasta temporária com dist + vercel.json (sem .env*, sem .vercel de outro projeto)
mkdir -p /tmp/fruiqo-web && cp -r dist/. /tmp/fruiqo-web/ && cp vercel.json /tmp/fruiqo-web/
cd /tmp/fruiqo-web
vercel link --yes --project fruiqo-web --scope diogo-daniel-pires-hitacarambis-projects
rm -f .env.local   # o link cria um token OIDC; nunca publicar
vercel deploy --prod --yes
```

Se o script inline do `index.html` mudar, recalcule o hash SHA-256 e atualize o `script-src` do `vercel.json`, senão o tema não é aplicado antes da primeira pintura.
