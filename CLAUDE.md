# CLAUDE.md

Fruiqo: app mobile (Expo) + web (Vite) + API (NestJS). O usuário compartilha post/texto/print; o backend extrai filmes/séries/música/livros e resolve contra TMDB/Spotify/Open Library.

- Decisões (D-xx): `docs/phase0/decisions.md`; requisitos `TOS-REQ`/`SEC-REQ`/`ARB-REQ`: seção 4 de `docs/phase0/decision-matrix.md`; spec v2 e fases: `docs/spec/` (`phases-v2.md`); rotas/RF-43..47: `apps/api/README.md`.
- Documentação, relatórios e textos do app são em português.

## Comandos (não óbvios)

- Monorepo pnpm, `node-linker=hoisted` (exigido pelo RN), Node ≥ 20.19.
- `pnpm infra:up` (Postgres 17 em 127.0.0.1:55432 + Redis 6379) → `pnpm build:packages` (obrigatório antes de api/mobile; `dist/` é gitignored).
- CI: `pnpm typecheck && pnpm test` + `fixtures:check` + web build + `pnpm eval --check` + `pnpm audit`. Não há lint (`pnpm lint` não faz nada).
- `pnpm fixtures:check` — `fixtures/` só sintéticas (repo público). Resposta real de TMDB vai só em `fixtures-private/` (gitignored).
- `pnpm eval [--check]` roda fixtures em `PIPELINE_MODE=mock`, sem rede.
- API (`apps/api`, lê `.env` copiado de `.env.example`): `pnpm db:migrate` / `db:generate` (Drizzle, de `src/db/schema.ts`), `pnpm dev` em **:4000** (a 3000 é de outro projeto), `pnpm dev:worker`, `pnpm test:unit` (sem infra), `pnpm test` (usa Postgres/Redis locais).
- Mobile: usa módulo nativo (`expo-share-intent`) → **não roda no Expo Go**, precisa de build EAS. APK `preview-apk` aponta para `10.0.2.2:4000`. Dev rápido: build `development` + `pnpm --filter @fruiqo/mobile dev:prod` (API de prod) ou `dev` (local). Módulo nativo novo exige novo build de dev.
- `pnpm --filter @fruiqo/mobile check:prod-bundle` prova que `app/dev` e `src/dev` ficam fora do bundle de prod → nada fora dessas pastas pode importá-las. `src/dev/fixtureIndex.generated.ts` é gerado por `node tools/fixtures/build_sim_index.mjs`.
- **Windows: não rode `pnpm add/install` com o Metro ligado** (trava `node_modules`, pacotes somem).
- Bench de modelos: `railway run --service api -- node tools/ai-bench/bench-*.mjs`.

## Regras que valem para qualquer mudança

- Fail-closed: integração/plataforma nova só com ToS e viabilidade avaliados (ARB-REQ-03).
- Nenhuma chave de terceiro no app (SEC-REQ-10). Logs sem token, senha ou texto compartilhado (redaction do pino).
- Conteúdo compartilhado é dado não confiável: nunca instrução ao LLM; o LLM **não recebe `tools`**; saída sempre validada por schema (fail-closed).
- Sem conteúdo real ao LLM enquanto PEND-10 (LGPD) aberta (D-04): extrator só com `LLM_ENABLED` **e** `LLM_REAL_CONTENT_ALLOWED`. Exceções: texto digitado pelo usuário (D-06/D-20) e texto de OCR com `AI_OCR_TEXT_ALLOWED` (D-24).
- D-07: com TMDB ativo, a API recusa subir com IA ligada até `TMDB_AI_CLEARANCE=confirmed` (`docs/phase0/tmdb-consulta-C15.md`). Nenhum dado TMDB/Spotify nem derivado (gêneros) entra em prompt (ARB-REQ-06; teste `apps/api/test/unit/d07-guard.test.ts`), exceto nomes de título/ano (D-25) e título oficial da obra de referência (D-28).
- D-08: todo caminho de LLM exige `user_settings.ai_consent`; humor do "Como estou" só guardado com `remember_mood` (90 dias); texto do "Como estou" nunca persistido/logado (RNF-06); risco (RNF-07, `detectRisk`) responde com CVV 188 e sem sugestões.
- Catálogo de filmes/séries é consulta ao vivo ao TMDB (nada copiado em massa, TOS-REQ-02). IMDb vetado. Links de serviço: nunca esquema de app nem link extraído de site de terceiro (D-22).
- Imagens (prints) nunca saem do aparelho/navegador: OCR local, só o texto vai à API (TOS-REQ-21). Capa de livro é só URL de `covers.openlibrary.org` (nunca baixada, nunca ao LLM).
- Mudou tratamento de dados (provedor novo, dado novo guardado) → atualize `apps/web/src/pages/Privacy.tsx` (texto e data).

## Invariantes de arquitetura

- **RLS** (SEC-REQ-16): app conecta como `fruiqo_app` (não dona das tabelas), policies por `app.user_id`. **Todo acesso a dado de usuário via `withUser()`**; lookup de login só por funções SECURITY DEFINER (`auth_lookup_user`, `auth_lookup_google`).
- `packages/contracts` (zod v4) é a fonte única dos formatos: API valida entrada, app/web validam resposta. Mudou contrato → rebuild do pacote e ajuste dos dois lados. O web importa o código-fonte TS via alias (o `dist` é CommonJS).
- `packages/taxonomy` é puro (sem I/O); nada com origem no TMDB vai ao LLM.
- API: `src/main.ts` (HTTP) e `src/worker.ts` (BullMQ) do mesmo código. `POST /shares` só persiste e enfileira. Pipeline: normalização (allowlist de domínio) → metadados **só via oEmbed oficial** com `safeFetch` (sem HTML/scraping, ARB-REQ-01/SEC-REQ-01) → extração → resolução → decisão. Toda chamada externa do pipeline passa pelo `PipelineGateway` (`fetchImpl`), senão mock/eval deixa de ser hermético.
- **`rank`** (fila 1..N por usuário): só triggers (`apps/api/drizzle/0008_title_rank.sql`) e `apps/api/src/library/rank-queue.ts` (advisory lock) escrevem. Só `to_watch`/`watching` têm rank.
- D-23: status `catalog` = conhecido sem intenção; import entra direto como `to_watch`/`cataloged` (sugestão do pipeline só em `suggested_decision`). Código de revisão (`review.service.ts`, `fit.ts`) é legado.
- Não repetir itens: `seen_pages` (hash por usuário), mescla de prints do mesmo share e índice único `(user_id, dedup_key)`.
- **LLM novo**: embrulhe com `trackingClient` e rode em `withAiUsage(userId, recurso, …)` (`apps/api/src/ai-usage/usage.ts`), senão o custo some de `ai_usage`. Só Anthropic (D-25), exceto gerador de títulos do "assistir hoje" com `AI_TONIGHT_TITLES_PROVIDER=openai` (D-26, `store: false`, fallback no `AI_TONIGHT_MODEL`). Haiku recusa `effort`.
- "Assistir hoje" (D-25): filme/série é busca do servidor no TMDB, não da IA; IA só complementa. Palavra-chave nova do TMDB: confira o nome exato (senão o tema nunca casa). Atributo `required` exige a palavra-chave.
- Música em texto: sob "Músicas:"/"Playlist:", "A - B" = Música - Artista; sem contexto, artista primeiro (convenção de vídeo).
- Web: sem regra de negócio no front (RF-30); access token só em memória; refresh por cookie `fruiqo_rt` (httpOnly, SameSite=Strict, Path=/auth) exigindo `X-Fruiqo-Client: web` + `Origin` em `WEB_ORIGIN`. Mobile: refresh no corpo, guardado no secure-store.
- Web/PWA no celular: campos com 16 px (Safari amplia) e nada passa da largura. `sw.js` nunca cacheia `/api`. CSP em `apps/web/vercel.json` (Open Library→`archive.org`, Google GSI, Tesseract `wasm-unsafe-eval`).
- Admin (`/admin`) exige MFA ligado e sessão `mfa_verified`. Reset de senha guarda só hash.
- Deploy: API + worker no Railway (`railway.toml`, `apps/api/Dockerfile`, worker com `FRUIQO_PROCESS=worker`); web na Vercel com rewrite `/api/*` → Railway (cookie first-party, D-19).
- `patches/expo-share-intent@8.0.1.patch` (F-01 cursor vazio, F-02 `content://`): mantenha ao atualizar o plugin.
