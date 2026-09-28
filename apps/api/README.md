# @fruiqo/api

API HTTP (NestJS) + worker (BullMQ) do Fruiqo. Postgres via Drizzle, Redis para a fila.
Contrato de request/response em `packages/contracts`.

## Rodar

```bash
pnpm infra:up                       # na raiz: Postgres (127.0.0.1:55432) + Redis (127.0.0.1:6379)
pnpm --filter @fruiqo/contracts build
cd apps/api
cp .env.example .env                # e gere um JWT_SECRET
pnpm db:migrate                     # aplica drizzle/*.sql com o owner
pnpm dev                            # API em 0.0.0.0:4000 (a porta 3000 é usada por outro projeto nesta máquina)
pnpm dev:worker                     # worker do pipeline + job de retenção
pnpm test                           # unit + integração (recria o banco fruiqo_test)
pnpm test:unit                      # só unit, sem banco
pnpm typecheck
```

Emulador Android acessa a API em `http://10.0.2.2:4000`; device físico, pelo IP da máquina na LAN.

## Endpoints

Todos exigem `Authorization: Bearer <accessToken>`, exceto os marcados como públicos.

| Método | Rota | Corpo / resposta (`@fruiqo/contracts`) |
|---|---|---|
| GET | `/health` (público) | `{ status: 'ok' }` |
| POST | `/auth/register` (público) | `RegisterRequest` → 201 `TokenPair` |
| POST | `/auth/login` (público) | `LoginRequest` → 200 `TokenPair` |
| POST | `/auth/refresh` (público) | `RefreshRequest` → 200 `TokenPair` (refresh rotacionado) |
| POST | `/auth/logout` | 204, revoga a sessão atual |
| GET | `/auth/sessions` | `Session[]` |
| DELETE | `/auth/sessions/:id` | 204 |
| POST | `/shares` | `CreateShareRequest` → 201 `Share` (novo) ou 200 (retry do mesmo `clientShareId`) |
| GET | `/shares?cursor=` | `ShareListResponse` (20 por página) |
| GET | `/shares/:id` | `Share` (cada recomendação traz `decision`: `cataloged` ou `review_queue`) |
| GET | `/shares/:id/steps` | `ShareStepsResponse`: etapas do pipeline em ordem + decisão por candidato (RF-19) |
| DELETE | `/shares/:id` | 204 |
| GET | `/library?status=&kind=&genre=&listId=&q=&sort=&cursor=&limit=` | `LibraryResponse` (só `cataloged`; `sort` = `priority`\|`recent`\|`title`) |
| GET/PATCH | `/library/:id` | `Title`; PATCH `UpdateTitleRequest` (gêneros manuais → `enrichment: manual`); 409 `{error:'conflict', conflictWith}` se a nova `dedup_key` colidir |
| GET/POST | `/lists` | `ListSummary[]` / `CreateListRequest` → 201 `ListDetail` |
| GET/DELETE | `/lists/:id` | `ListDetail` / 204 |
| PUT | `/lists/:id/items` | `ReorderListRequest` (ordem completa) → `ListDetail` |
| GET | `/home` | `HomeResponse`: "Continuar", presets de subgênero, estatísticas, `aiMode` |
| POST | `/discover` | `DiscoverRequest` (`surprise` por subgênero/gênero ou `mood` por texto) → `DiscoverResponse` |
| POST | `/feedback` | `FeedbackRequest` (`accept`/`skip`/`another`) → `{ next }` |

Erros seguem `ApiError` (`{ error, message }`), sem detalhes internos.

## Variáveis

Ver `.env.example`. As principais:

- `DATABASE_URL`: role `fruiqo_app` (sem ownership, sujeita a RLS). `DATABASE_URL_OWNER`: só para migrações.
- `JWT_SECRET` (≥ 32 chars), `ACCESS_TOKEN_TTL_SECONDS` (padrão 900).
- `REGISTRATION_ENABLED`, `ALLOWED_EMAILS`: registro fechado/allowlist (SC-PERSONAL).
- `AUTH_RATE_LIMIT_PER_MIN`: limite por IP nas rotas públicas de auth (padrão 10).
- `LLM_ENABLED`, `LLM_REAL_CONTENT_ALLOWED`, `LLM_MODEL` (padrão `claude-opus-5`), `LLM_DAILY_QUOTA`, `LLM_MAX_INPUT_CHARS`, `ANTHROPIC_API_KEY`.
- `PIPELINE_MODE` (`live`/`mock`/`record`), `REVIEW_THRESHOLD` (0.5), `DISCARD_THRESHOLD` (0.15), `SANDBOX_ENABLED`, `LLM_PRICE_IN_PER_MTOK`/`LLM_PRICE_OUT_PER_MTOK`: Fase 2a (seção abaixo).
- `TMDB_API_KEY` (v3 ou token v4), `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`, `META_OEMBED_ACCESS_TOKEN`: opcionais; sem eles o share é processado sem resolução/metadados daquela fonte.

## Decisões

- **RLS (SEC-REQ-16, D-01)**: `users`, `sessions`, `shares` e `recommendations` têm RLS `FORCE`; as policies comparam
  `user_id` com `current_setting('app.user_id')`. Todo acesso passa por `withUser()` (`src/db/client.ts`), que abre
  transação e faz `set_config(..., true)`. O worker faz o mesmo por job.
- **Login sem contexto**: o único lookup sem `app.user_id` é a função `auth_lookup_user(email)` (`SECURITY DEFINER`,
  `search_path` fixo, `EXECUTE` só para `fruiqo_app`), que devolve apenas id, hash e estado de lockout. O resto do login
  roda com o contexto do usuário encontrado. O refresh token carrega `userId.sessionId.segredo`: os IDs só dizem onde
  procurar, e só o hash SHA-256 do segredo fica no banco. E-mail inexistente gasta o mesmo tempo de uma verificação real.
- **Sessões**: refresh rotaciona a cada uso; apresentar o refresh anterior revoga a sessão (detecção de reuso). Sessão
  revogada invalida o access token na hora (o guard confere a sessão). Lockout de 15 min após 5 senhas erradas.
- **Retenção (TOS-REQ-02/05)**: `purge_expired_third_party_data()` (`SECURITY DEFINER`) roda a cada 6 h no worker e
  apaga resoluções TMDB > 180 dias e metadados do YouTube > 30 dias. O texto bruto do share é apagado quando o
  processamento termina.
- **Fetch de saída (SEC-REQ-01, ARB-REQ-01)**: `safeFetchJson` só fala com hosts fixos (oEmbed do YouTube/TikTok, Graph
  da Meta, TMDB, Spotify), só https, sem redirect, com timeout de 5 s, até 256 KB e só JSON. URL do usuário nunca é
  destino, só parâmetro de oEmbed. `music.youtube.com` e domínios desconhecidos viram `other` e não são buscados.
- **LLM (D-04)**: o `AnthropicExtractor` só é criado com `LLM_ENABLED=true` **e** `LLM_REAL_CONTENT_ALLOWED=true`
  (a segunda só depois de fechar a PEND-10). Sem tools, com conteúdo delimitado como dado e structured outputs; a saída é
  revalidada com `LlmExtractionSchema` (fail-closed). Quota diária por usuário no Redis. Qualquer falha cai na heurística.
  Nada de TMDB/Spotify entra no prompt (ARB-REQ-02).
- **Produção**: o owner das migrações não deve ser superusuário; as policies `*_definer_*` já cobrem o owner das funções.

## Prints de tela e deduplicação

O OCR roda no aparelho (TOS-REQ-21): o app manda só o texto de cada print em `pages` (até 10 × 8000 caracteres). O share fica com `origin = screenshot` e plataforma `other`, sem oEmbed nem inferência de plataforma pelo texto. O texto dos prints é apagado ao fim do processamento, como o `input_text`.

A deduplicação acontece em três níveis (`src/pipeline/dedup.ts`):

1. **Print repetido.** O servidor calcula o sha256 do texto normalizado (NFKC, sem acento, minúsculas, espaços colapsados, sem linhas vazias) e o registra em `seen_pages`, que guarda só o hash e tem RLS. Um print já registrado por outro share do usuário é ignorado e soma em `dedup.pagesIgnored`. O `ON CONFLICT` resolve a corrida entre jobs. Um share que falha ou é apagado libera o print, porque os hashes somem junto com ele.
2. **Sobreposição da rolagem.** O `mergePages` junta os prints na ordem e descarta as linhas normalizadas já vistas no mesmo share.
3. **Item repetido.** A `dedup_key` é única por usuário e formada pelo grupo (`screen` para filme e série, `music` para faixa, álbum e artista, `other`) mais o título normalizado (sem numeração, sem ano entre parênteses, sem pontuação). Em música, o criador também entra na chave. Um item que o usuário já tem em outro share não é inserido e soma em `dedup.itemsAlreadyInList`; esse item também não gasta chamada de TMDB/Spotify. Isso vale também para shares de link.

A extração sem LLM segue dois passos:

- **Limpeza** (`src/pipeline/ui-noise.ts`): remove as linhas de interface (horário, "Curtido por", contadores, "há 2 dias", @handles etc.). Para cobrir outro app, estenda a lista e o teste `test/unit/ui-noise.test.ts`.
- **Itens de lista** (`src/pipeline/extractors/list.ts`): aproveita só linhas numeradas, com bullet ou emoji de número, "Título (2019)" e "Artista - Música". O tipo vem do vocabulário do texto (filmes, séries, música, álbum); a confiança fica em no máximo 0,6, com limite de 50 itens.
- **Limitação conhecida**: linhas soltas sem marcador são ignoradas. Um carrossel com um título por slide, sem numeração, não é extraído.

A migração `0002` faz o backfill da `dedup_key` em SQL, aproximando a normalização do TypeScript, e apaga colisões antigas mantendo a recomendação mais antiga.

## Sandbox, fixtures e eval (Fase 2a)

- **Etapas (RF-19)**: cada processamento grava `pipeline_step_logs` (`normalize`, `metadata`, `ocr_input`, `merge_pages`, `noise_filter`, `extract`, `dedup`, `resolve`, `decide`) com duração, tokens, custo e erro, e `candidate_decisions` por candidato. Tudo com RLS FORCE. Trechos de texto de terceiros (`preview`, ≤ 200 caracteres) só são gravados em shares de fixture (`is_fixture`, marcado pelo cabeçalho `X-Fruiqo-Fixture` com `SANDBOX_ENABLED=true`, nunca em produção).
- **Decisão (RF-28)**: confiança < `DISCARD_THRESHOLD` → `discarded` (não vira recomendação); < `REVIEW_THRESHOLD` → `review_queue`; com resolver disponível e sem correspondência → `review_queue`; senão `cataloged`. A dedup de 3 níveis vale para `cataloged` e `review_queue`.
- **`PipelineGateway` (RF-20)**: toda chamada externa passa por ele (`src/pipeline/gateway.ts`). `mock` responde com `fixtures/**/recordings` e `fixtures-private/**/recordings` e nunca usa a rede (gravação ausente = resolver indisponível); `record` grava só em `fixtures-private/`, sem credenciais; gravações reais vencem (TMDB 180 dias, YouTube 30 dias). Ações externas (playlist, deep link) ficam só simuladas fora do `live` (RF-23).
- **Fixtures (RF-21)**: `fixtures/` só com conteúdo sintético (formato em `fixtures/README.md`, geradas por `pnpm fixtures:build`, checadas por `pnpm fixtures:check`). Prints e gravações reais vão em `fixtures-private/` (gitignored).
- **Eval (RF-22)**: `pnpm eval [--set public|private|all] [--label x] [--compare arquivo.json] [--check] [--write-baseline]`. Recria o banco `fruiqo_eval`, passa cada fixture pelo mesmo `SharesService.create` + `ShareProcessor` em `mock` com a rede bloqueada e grava `reports/eval-*.{md,json}` (gitignored). Baseline versionada: `eval-baselines/v0-heuristic.json`. `--check` falha com recall de risco < 100%, queda de F1 ou checagem nova falhando.

## Catálogo, listas e home (Fase 2b)

- **Modelo**: a tabela `recommendations` virou o catálogo (status `to_watch|watching|watched|dropped`, `priority` 0–3, `rating` 1–5, `genres` da taxonomia, `enrichment`, `notes`). Não criamos `titles` separada para não mexer na dedup de 3 níveis (índice único `(user_id, dedup_key)` segue valendo). `share_id` ficou nulo-ável para títulos do seed/adição manual. Tabelas novas com RLS FORCE: `lists`, `list_items`, `taste_signals`, `recommendation_runs`, `recommendation_feedback`.
- **Lista automática**: share de prints com ≥ 2 itens catalogados vira uma lista (nome = linha de cabeçalho do OCR, senão "Prints de <data>"), incluindo itens que o usuário já tinha.
- **Ranking** (`src/library/ranking.ts`): local e determinístico. Candidatos = títulos para ver/em andamento; score = aderência à intenção (pesos da taxonomia) + perfil de gosto (sinais) + prioridade − pulados nos últimos 14 dias. Sem gênero cadastrado só completa a lista, com motivo honesto. O "por que isso" sai dos mesmos fatores.
- **"Como estou"** (RNF-06/07): o texto só existe em memória (risco + `interpretMood`); o banco guarda a intenção estruturada em `recommendation_runs`, e nada quando há risco (só `risk_shown`). Risco devolve o acolhimento com CVV 188 e zero sugestões até `continueAfterRisk`. `AI_MODE=rules` (padrão) é local; `anthropic` ainda cai nas regras; `off` desliga o modo.
- **Seed**: `pnpm seed:demo -- --email <email> [--password <senha>]` insere 32 títulos com gêneros escritos pelo time (`enrichment: demo`, nada do TMDB), 3 listas (a "Maratona" já em andamento) e notas. Idempotente e não apaga nada.

## Sistema web (Fase 2c)

| Área | Rotas |
|---|---|
| Auth web (RF-30) | `POST /auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout` com `X-Fruiqo-Client: web` + `Origin` em `WEB_ORIGIN`. Corpo: `{accessToken, expiresIn}`; refresh só no cookie `fruiqo_rt` (httpOnly, SameSite=Strict, Path=/auth, Secure em https). Sem o cabeçalho, o cookie é ignorado. |
| Catálogo (RF-24/25) | `GET /library` (filtros `status`, `kind`, `genre`, `priority`, `listId`, `shareId`, `review=pending`, `q`), `POST /library`, `POST /library/bulk`, `POST /library/bulk/undo` |
| Listas (RF-26) | `PATCH /lists/:id` (nome, fixar), `POST /lists/:id/duplicate` |
| Correção (RF-27) | `POST /library/:id/correct` (409 com `suggestion: 'merge'`), `POST /library/:id/merge` |
| Revisão (RF-28) | `GET /review`, `POST /review/:id/approve`, `/reject`, `/rematch` |
| Activity (RF-19) | `GET /activity` (etapas resumidas, contagens por decisão, custo) |
| Perfil (RF-29/38, RNF-06/10) | `GET/PATCH /profile/taste`, `GET/PUT /profile/subscriptions`, `GET/DELETE /profile/mood-history` |
| Sandbox (RF-19/22) | `GET /sandbox/fixtures`, `POST /sandbox/fixtures/:id/run`, `GET /sandbox/evals` (404 sem `SANDBOX_ENABLED`) |

Decisões: o desfazer guarda um snapshot em `bulk_undo` (uso único, 10 min); desfazer uma remoção devolve títulos e listas, mas não os sinais de gosto apagados em cascata. O merge move listas, sinais, feedback e decisões para o destino e preenche os campos vazios dele. O sandbox roda a fixture num usuário efêmero, apagado no fim, para o resultado não depender da biblioteca de quem pediu.

## TMDB e recomendação inteligente (Fase 2d)

- **Enriquecimento TMDB**: ao catalogar um filme/série, o pipeline busca no TMDB (`search/multi` + detalhes com `external_ids,watch/providers` numa chamada) e grava gêneros (mapeados para a taxonomia própria), sinopse, pôster, duração, `imdbId` (só guardado) e onde assistir no BR (assinatura/aluguel/compra, com o link público "onde assistir" do TMDB). Gêneros marcados à mão (`manual`) nunca são sobrescritos. A purga de 180 dias (TOS-REQ-02) zera também o que foi derivado do TMDB.
- **Sob demanda**: `POST /library/:id/enrich` → `{ status: enriched | no_match | unsupported | unavailable, title }`.
- **Backfill**: `pnpm --filter @fruiqo/api enrich:backfill -- --email <e> [--include-demo] [--limit N] [--concurrency 2] [--delay-ms 250]`. Usa o `PIPELINE_MODE` do ambiente (`mock` roda com as gravações sintéticas de `fixtures/`).
- **Ligar o TMDB**: coloque `TMDB_API_KEY` no `apps/api/.env` (chave v3 de 32 caracteres ou token v4/Bearer; o resolver detecta), `PIPELINE_MODE=live`, reinicie API e worker e rode o backfill. A chave fica só no servidor.
- **Disponibilidade (RF-38)**: títulos disponíveis por assinatura nos serviços declarados em `/profile/subscriptions` ganham boost no `/discover` e preferência no "Continuar", com o motivo explícito ("disponível na Netflix, que você assina"). Sem assinatura cadastrada, sem boost.
- **`AI_MODE`** (D-06): `rules` (padrão, local), `anthropic` (usa `AI_MODEL`, padrão `claude-haiku-4-5`, só com `ANTHROPIC_API_KEY`; sem chave continua nas regras) ou `off`. O LLM recebe só o texto digitado pelo usuário (`LlmSafeInput`), sem tools; a saída é validada pelo `MoodIntentSchema` e qualquer erro, recusa ou quota esgotada (`AI_DAILY_QUOTA`) cai para as regras. O detector de risco roda antes e, com risco, o LLM nunca é chamado. Cada execução grava intérprete, tokens e custo estimado (`AI_PRICE_*_PER_MTOK`) em `recommendation_runs`, nunca o texto.
