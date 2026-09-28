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
| GET | `/shares/:id` | `Share` |
| DELETE | `/shares/:id` | 204 |

Erros seguem `ApiError` (`{ error, message }`), sem detalhes internos.

## Variáveis

Ver `.env.example`. As principais:

- `DATABASE_URL`: role `fruiqo_app` (sem ownership, sujeita a RLS). `DATABASE_URL_OWNER`: só para migrações.
- `JWT_SECRET` (≥ 32 chars), `ACCESS_TOKEN_TTL_SECONDS` (padrão 900).
- `REGISTRATION_ENABLED`, `ALLOWED_EMAILS`: registro fechado/allowlist (SC-PERSONAL).
- `AUTH_RATE_LIMIT_PER_MIN`: limite por IP nas rotas públicas de auth (padrão 10).
- `LLM_ENABLED`, `LLM_REAL_CONTENT_ALLOWED`, `LLM_MODEL` (padrão `claude-opus-5`), `LLM_DAILY_QUOTA`, `LLM_MAX_INPUT_CHARS`, `ANTHROPIC_API_KEY`.
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
