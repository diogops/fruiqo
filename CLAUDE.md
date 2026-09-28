# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado do projeto

Fruiqo é um app mobile (Android + iOS) + backend: o usuário compartilha um post (Instagram, YouTube, TikTok) com o app pelo share sheet, o backend extrai recomendações de filmes/séries/música e as resolve contra TMDB/Spotify, com links de volta para os serviços.

- **Fase 0 (discovery) concluída**: relatórios em `docs/phase0/`. As decisões do dono do produto estão em `docs/phase0/decisions.md` (D-01 a D-05) e os requisitos herdados (`TOS-REQ-xx`, `SEC-REQ-xx`, `ARB-REQ-xx`) na seção 4 de `docs/phase0/decision-matrix.md`. Resultados de teste em device ficam em `docs/phase0/device-tests-log.md`.
- **Fase 1 em andamento**: versão inicial no cenário SC-PERSONAL (1 usuário), com a arquitetura já preparada para SC-STORE (D-01).

## Comandos

Monorepo pnpm (`node-linker=hoisted`, exigido pelo React Native). Node ≥ 20.19.

```bash
pnpm install
pnpm infra:up                               # Postgres 17 (127.0.0.1:55432) + Redis (127.0.0.1:6379) via Docker
pnpm --filter @fruiqo/contracts build       # obrigatório antes de api/mobile (dist/ é gitignored)
pnpm typecheck && pnpm test                 # tudo; é o que a CI roda

# API (apps/api): lê apps/api/.env (copie de .env.example)
cd apps/api
pnpm db:migrate                             # aplica migrações Drizzle com o owner
pnpm dev                                    # HTTP em 0.0.0.0:4000 (a 3000 é usada por outro projeto na máquina)
pnpm dev:worker                             # worker BullMQ
pnpm test                                   # vitest; integração usa o Postgres/Redis locais (cria o banco de teste)
npx vitest run test/unit/normalize.test.ts  # um arquivo
npx vitest run -t "nome do teste"           # um teste

# App (apps/mobile)
cd apps/mobile
npx jest                                    # testes (jest-expo)
npx expo export --platform android          # checa o bundle
EAS_NO_VCS=1 EAS_PROJECT_ROOT=../.. eas build --profile preview-apk --platform android
```

O app usa módulo nativo (`expo-share-intent`), então **não roda no Expo Go**: precisa de build (EAS). O APK `preview-apk` aponta para `http://10.0.2.2:4000` (emulador → host); para celular físico, troque `EXPO_PUBLIC_API_URL` no `eas.json` pelo IP da máquina na rede.

## Arquitetura

- `packages/contracts`: schemas zod v4 do contrato HTTP (auth, shares, recomendações) e da saída do LLM. É a fonte única dos formatos: a API valida as entradas com eles e o app valida as respostas. Mudou o contrato → rebuild do pacote e ajuste nos dois lados.
- `apps/api` (NestJS 12, ESM, Drizzle + pg, BullMQ): dois entrypoints do mesmo código, `src/main.ts` (HTTP) e `src/worker.ts` (fila). O `POST /shares` só persiste e enfileira; o worker roda o pipeline, nesta ordem (ARB-REQ-02):
  1. normalização: allowlist de domínio e remoção de parâmetros de rastreamento;
  2. metadados **só via oEmbed oficial**, com o cliente `safeFetch`: allowlist fixa de host, sem HTML e sem scraping (ARB-REQ-01, SEC-REQ-01);
  3. extração: heurística por padrão; o extrator Anthropic só liga com `LLM_ENABLED` **e** `LLM_REAL_CONTENT_ALLOWED` (D-04), e a saída dele é validada contra `LlmExtractionSchema` (fail-closed);
  4. resolução TMDB/Spotify, só quando há chave.
- **Multi-tenancy por RLS** (SEC-REQ-16): a app conecta como `fruiqo_app`, que não é dona das tabelas, e as policies usam `app.user_id`. Todo acesso a dados de usuário passa por `withUser()`. O login usa a função `auth_lookup_user` (SECURITY DEFINER). Nunca consulte tabelas de usuário fora de `withUser()`.
- `apps/mobile` (Expo SDK 57 + Expo Router): `app/_layout.tsx` redireciona consentimento → login → inbox. O share recebido vira `CreateShareRequest` em `src/share/`, com `clientShareId` para idempotência. O cliente em `src/api/client.ts` guarda o access token em memória e o refresh token no secure-store, com rotação em 401.
- **Prints de tela**: o OCR roda no aparelho (`expo-text-extractor`: ML Kit/Vision; TOS-REQ-21) e só o texto vai à API, em `pages`. A imagem nunca sai do celular. Não repetir itens é regra do produto, garantida no backend em três níveis: hash da página por usuário (`seen_pages`), mescla de linhas sobrepostas entre prints do mesmo share, e índice único `(user_id, dedup_key)` em `recommendations`. A normalização das chaves e a lista de ruído de UI ficam em `apps/api/src/pipeline/`.
- `patches/expo-share-intent@8.0.1.patch` (registrado em `pnpm-workspace.yaml`) corrige no plugin o crash com cursor vazio (F-01) e o uso do caminho absoluto em vez da `content://` (F-02, EACCES no OCR). Mantenha o patch ao atualizar o plugin.

## Regras que valem para qualquer mudança

- Fail-closed: integração/plataforma nova só com status de ToS e viabilidade avaliados (ARB-REQ-03); sem evidência → não entra.
- Nenhuma chave de terceiro no app: tudo passa pelo backend (SEC-REQ-10). Logs não podem conter token, senha nem texto compartilhado (redaction do pino).
- Conteúdo compartilhado é dado não confiável: nunca instrução ao LLM, e o LLM não recebe `tools`.
- Não enviar conteúdo real ao LLM enquanto a PEND-10 (transferência internacional/LGPD) estiver aberta (D-04).
- Documentação, relatórios e textos do app são em português.
