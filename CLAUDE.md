# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado do projeto

Fruiqo é um app mobile (Android + iOS) + backend: o usuário compartilha um post (Instagram, YouTube, TikTok) com o app pelo share sheet, o backend extrai recomendações de filmes/séries/música e as resolve contra TMDB/Spotify, com links de volta para os serviços.

- **Fase 0 (discovery) concluída**: relatórios em `docs/phase0/`. As decisões do dono do produto estão em `docs/phase0/decisions.md` (D-01 a D-06) e os requisitos herdados (`TOS-REQ-xx`, `SEC-REQ-xx`, `ARB-REQ-xx`) na seção 4 de `docs/phase0/decision-matrix.md`. Resultados de teste em device ficam em `docs/phase0/device-tests-log.md`.
- **Fase 1 v0 publicada**; a **v2** (simulador, sistema web, recomendação) está especificada em `docs/spec/` (delta, arquitetura, wireframes, taxonomia, fases). Fase 2a (sandbox, pipeline instrumentado, fixtures, eval, taxonomia) implementada; 2b–2d seguem `docs/spec/phases-v2.md`.

## Comandos

Monorepo pnpm (`node-linker=hoisted`, exigido pelo React Native). Node ≥ 20.19.

```bash
pnpm install
pnpm infra:up                               # Postgres 17 (127.0.0.1:55432) + Redis (127.0.0.1:6379) via Docker
pnpm build:packages                         # taxonomy + contracts; obrigatório antes de api/mobile (dist/ é gitignored)
pnpm typecheck && pnpm test                 # tudo; a CI roda isso + fixtures:check + eval --check
pnpm fixtures:check                         # fixtures/ só sintéticas (repositório público)
pnpm fixtures:build                         # regenera fixtures/ (Python + Pillow) a partir de tools/fixtures/
pnpm eval [--check] [--label x]             # fixtures no pipeline em PIPELINE_MODE=mock, sem rede; relatório em reports/

# API (apps/api): lê apps/api/.env (copie de .env.example)
cd apps/api
pnpm db:migrate                             # aplica migrações Drizzle com o owner
pnpm dev                                    # HTTP em 0.0.0.0:4000 (a 3000 é usada por outro projeto na máquina)
pnpm dev:worker                             # worker BullMQ
pnpm test                                   # vitest; integração usa o Postgres/Redis locais (cria o banco de teste)
pnpm seed:demo -- --email dev@fruiqo.test   # títulos/listas de demonstração (RF-17), sem apagar nada
npx vitest run test/unit/normalize.test.ts  # um arquivo
npx vitest run -t "nome do teste"           # um teste

# App (apps/mobile)
cd apps/mobile
npx jest                                    # testes (jest-expo)
npx expo export --platform android          # checa o bundle
EAS_NO_VCS=1 EAS_PROJECT_ROOT=../.. eas build --profile preview-apk --platform android

# Sistema web (apps/web): Vite + React, contra a API em :4000 (WEB_ORIGIN inclui http://localhost:5173)
pnpm --filter @fruiqo/web dev               # http://localhost:5173
pnpm --filter @fruiqo/web test              # vitest + Testing Library (jsdom)
pnpm --filter @fruiqo/web build             # tsc + vite build (a CI roda)
```

Preview do app no navegador: `pnpm --filter @fruiqo/mobile web` (API com `WEB_ORIGIN=http://localhost:8082`). O simulador de share `/dev/share` (Ajustes, só fora de produção) envia link/texto/imagens/fixtures por `receiveShare`, o mesmo ponto de entrada do share real; `pnpm --filter @fruiqo/mobile check:prod-bundle` prova que `app/dev` e `src/dev` ficam fora do bundle de produção, então nada fora dessas pastas pode importá-las. O índice de fixtures do simulador (`apps/mobile/src/dev/fixtureIndex.generated.ts`) é gerado por `node tools/fixtures/build_sim_index.mjs` e checado no `pnpm fixtures:check`.

**Não rode `pnpm add`/`pnpm install` com o Metro ligado no Windows**: ele trava arquivos do `node_modules` e a instalação fica pela metade (pacotes somem). Pare o Metro antes.

O app usa módulo nativo (`expo-share-intent`), então **não roda no Expo Go**: precisa de build (EAS). O APK `preview-apk` aponta para `http://10.0.2.2:4000` (emulador → host); para celular físico, troque `EXPO_PUBLIC_API_URL` no `eas.json` pelo IP da máquina na rede.

## Arquitetura

- **TMDB (2d)**: enriquecimento no pipeline, sob demanda (`POST /library/:id/enrich`) e por backfill (`pnpm --filter @fruiqo/api enrich:backfill -- --email <e> [--include-demo]`). A chave (`TMDB_API_KEY`) fica só no `apps/api/.env`. Respostas reais do TMDB nunca vão para `fixtures/` (só `fixtures-private/`). O app e o web mostram onde assistir com o crédito JustWatch/TMDB e abrem só a página pública do TMDB (sem deep link para streaming, TOS-REQ-17).
- `packages/taxonomy`: taxonomia v1 versionada (gêneros próprios ↔ IDs do TMDB, subgêneros, intenção de humor `MoodIntent`, pesos), o detector de risco local (RNF-07, resposta com CVV 188) e o `interpretMood` por regras (modo `rules`). Puro, sem I/O. Nada com origem no TMDB vai para o LLM.
- `packages/contracts`: schemas zod v4 do contrato HTTP (auth, shares, recomendações, etapas do pipeline) e da saída do LLM. É a fonte única dos formatos: a API valida as entradas com eles e o app valida as respostas. Mudou o contrato → rebuild do pacote e ajuste nos dois lados.
- `apps/api` (NestJS 12, ESM, Drizzle + pg, BullMQ): dois entrypoints do mesmo código, `src/main.ts` (HTTP) e `src/worker.ts` (fila). O `POST /shares` só persiste e enfileira; o worker roda o pipeline, nesta ordem (ARB-REQ-02):
  1. normalização: allowlist de domínio e remoção de parâmetros de rastreamento;
  2. metadados **só via oEmbed oficial**, com o cliente `safeFetch`: allowlist fixa de host, sem HTML e sem scraping (ARB-REQ-01, SEC-REQ-01);
  3. extração: heurística por padrão; o extrator Anthropic só liga com `LLM_ENABLED` **e** `LLM_REAL_CONTENT_ALLOWED` (D-04), e a saída dele é validada contra `LlmExtractionSchema` (fail-closed);
  4. resolução TMDB/Spotify, só quando há chave;
  5. decisão por candidato (`cataloged` / `review_queue` / `discarded`, limiares por env).
  Cada etapa é gravada em `pipeline_step_logs` + `candidate_decisions` (`GET /shares/:id/steps`), e toda chamada externa passa pelo `PipelineGateway` (`PIPELINE_MODE` = `live` / `mock` / `record`). Chamada nova à rede no pipeline tem que passar pelo gateway (`fetchImpl`), senão o mock/eval deixa de ser hermético.
- **Multi-tenancy por RLS** (SEC-REQ-16): a app conecta como `fruiqo_app`, que não é dona das tabelas, e as policies usam `app.user_id`. Todo acesso a dados de usuário passa por `withUser()`. O login usa a função `auth_lookup_user` (SECURITY DEFINER). Nunca consulte tabelas de usuário fora de `withUser()`.
- `apps/mobile` (Expo SDK 57 + Expo Router): `app/_layout.tsx` redireciona consentimento → login → inbox. O share recebido vira `CreateShareRequest` em `src/share/`, com `clientShareId` para idempotência. O cliente em `src/api/client.ts` guarda o access token em memória e o refresh token no secure-store, com rotação em 401.
- **Prints de tela**: o OCR roda no aparelho (`expo-text-extractor`: ML Kit/Vision; TOS-REQ-21) e só o texto vai à API, em `pages`. A imagem nunca sai do celular. Não repetir itens é regra do produto, garantida no backend em três níveis: hash da página por usuário (`seen_pages`), mescla de linhas sobrepostas entre prints do mesmo share, e índice único `(user_id, dedup_key)` em `recommendations`. A normalização das chaves e a lista de ruído de UI ficam em `apps/api/src/pipeline/`.
- **Catálogo e recomendação** (`apps/api/src/library/`): `recommendations` é o catálogo do usuário (status, prioridade, nota, gêneros da taxonomia). Home/"Continuar", "Surpreenda-me" e "Como estou" usam ranking local e determinístico (`ranking.ts`); o texto do "Como estou" nunca é persistido nem logado (RNF-06), e risco (RNF-07) responde com CVV e sem sugestões.
- **Sistema web (backend, Fase 2c)**: o web se identifica com `X-Fruiqo-Client: web`; login/registro/refresh devolvem só o access token no corpo e o refresh vai no cookie `fruiqo_rt` (httpOnly, SameSite=Strict, Path=/auth). Refresh do web exige cookie + esse cabeçalho + `Origin` em `WEB_ORIGIN` (CSRF); o app mobile segue com refresh no corpo. Rotas de organização em `catalog.service.ts`: `POST /library/bulk` (transacional, com `undoToken` de 10 min em `bulk_undo`), correção/merge e fila de revisão (gravam `review_actions`), `GET /activity`, perfil de gosto com overrides que o `/discover` respeita, assinaturas declaradas e `/sandbox/*` (só com `SANDBOX_ENABLED`; roda a fixture num usuário efêmero).
- `apps/web` (Vite + React + react-router + TanStack Query): só consome a API (RF-30), sem regra de negócio no front; filtros, ordenação e ranking vêm do servidor, e toda resposta é validada com `@fruiqo/contracts` (importado pelo código-fonte TS via alias no `vite.config.ts`, porque o `dist` é CommonJS). `src/api/client.ts` guarda o access token só em memória, manda `credentials: 'include'` + `X-Fruiqo-Client: web` e renova pelo cookie em 401 (uma renovação por vez). Telas em `src/pages/` (Catálogo com ações em massa + desfazer, Listas com drag-and-drop, Revisão com atalhos de teclado, Atividade/inspector, Perfil, Sandbox).
- `patches/expo-share-intent@8.0.1.patch` (registrado em `pnpm-workspace.yaml`) corrige no plugin o crash com cursor vazio (F-01) e o uso do caminho absoluto em vez da `content://` (F-02, EACCES no OCR). Mantenha o patch ao atualizar o plugin.

## Regras que valem para qualquer mudança

- Fail-closed: integração/plataforma nova só com status de ToS e viabilidade avaliados (ARB-REQ-03); sem evidência → não entra.
- Nenhuma chave de terceiro no app: tudo passa pelo backend (SEC-REQ-10). Logs não podem conter token, senha nem texto compartilhado (redaction do pino).
- Conteúdo compartilhado é dado não confiável: nunca instrução ao LLM, e o LLM não recebe `tools`.
- Não enviar conteúdo real ao LLM enquanto a PEND-10 (transferência internacional/LGPD) estiver aberta (D-04).
- Documentação, relatórios e textos do app são em português.
