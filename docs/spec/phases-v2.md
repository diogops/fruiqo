# Plano de fases v2

Parte do estado atual (Fase 1 v0 publicada; ver `delta-v2.md` §1). A ordem segue a sugestão do prompt: validar extração e OCR antes de caprichar nas telas.

## Pré-requisitos transversais

| ID | Item | Dono | Bloqueia |
|---|---|---|---|
| PRE-01 | Chave TMDB (gratuita) no `apps/api/.env`. **Nunca** no repositório nem no app | Usuário (vai criar) | Enriquecimento, gêneros, providers BR, RF-32/35/38 com dados reais. Sem ela: `enrichment = 'demo'` e modo `mock` |
| PRE-02 | Chave Anthropic | Usuário (pendente) | `AI_MODE=anthropic` (RF-33 com LLM, tag L de subgênero). Sem ela: IA **pronta mas desligada**, e `rules` funciona |
| PRE-03 | Aprovação deste delta v2 e dos diffs de `platforms.md` e dos agentes (ToS/threat model) | Usuário | Início da 2a |
| PRE-04 | Rodada complementar da Fase 0: ToS de TMDB keywords/discover/similar para recomendação; Spotify recommendations; LGPD do dado de humor; threat model F-10/F-11 | Agentes da Fase 0 | Tudo marcado `DEPENDE DA FASE 0` (RF-18b, RF-32 K, RF-35 externo, RF-39 externo, RNF-06 SC-STORE) |

## Fase 2a: sandbox, pipeline instrumentado e fixtures

| Entregável | Requisitos | Critério de saída |
|---|---|---|
| `pipeline_step_logs` + `candidate_decisions` + `GET /shares/:id/steps` | RF-19 | Todo share tem as etapas logadas; teste de integração com fixture |
| `PipelineGateway` com `mock`/`live`/`record` | RF-20, RF-23 | CI roda o pipeline em `mock` com a rede bloqueada; `record` recusado em produção |
| `fixtures/` sintéticas (≥ 12) + `fixtures-private/` gitignored + checagem no CI | RF-21 | CI falha com fixture não sintética em `fixtures/` |
| `pnpm eval` + relatório + comparação | RF-22 | Relatório com precision/recall/F1, acerto de kind e de resolução; baseline registrada (label `v0-heuristic`) |
| Decisão `cataloged`/`review_queue`/`discarded` no worker | RF-19, RF-28 (backend) | `REVIEW_THRESHOLD` configurável; testes |
| `packages/taxonomy` v1 + detector de risco + `RulesInterpreter` | RNF-07, RF-33 (parte local) | Recall de 100% nas fixtures de risco; convergência das fixtures de intenção em `rules` |

Dependências: PRE-03. A PRE-01 não bloqueia, porque o `mock` usa gravações sintéticas.

## Fase 2b: app mobile

> Inclui RF-40 (importar prints pelo seletor do sistema, sem permissão de galeria), adicionado em 2026-09-28.

| Entregável | Requisitos | Critério de saída |
|---|---|---|
| Expo web + seed `demo` + fallbacks de módulos nativos | RF-17 | Navegador desktop abre as telas principais com seed |
| Simulador de share `/dev/share`, usando o mesmo handler | RF-18 | Teste de paridade de payload; rota ausente no bundle production |
| Catálogo básico no app: status, prioridade, rating, listas (leitura + reordenação simples) | RF-26 (parte), RF-34 (sinais) | `titles` e `lists` migrados; sinais `watched/rated/added_to_list` gravados |
| Home com "Continuar" | RF-31 | Próximo item correto em testes de ordenação |
| PDF on-device | RF-18b | Só depois da PRE-04 |

Dependências: 2a (endpoints de catálogo e listas).

## Fase 2c: sistema web (`apps/web`, Vite + React)

| Entregável | Requisitos | Critério de saída |
|---|---|---|
| Auth web com cookie `httpOnly` + CORS + CSRF por cabeçalho | RF-30 | Testes de integração: refresh por cookie, rejeição sem cabeçalho, sem origem permitida |
| Catálogo com filtros, busca e edição em massa + desfazer | RF-24, RF-25 | 1.000 itens < 1 s; bulk transacional testado |
| Listas com drag-and-drop e duplicar | RF-26 | Ordem persistida |
| Activity log + inspector + correção de match | RF-19, RF-27 | Correção grava `review_actions` e recalcula `dedup_key` |
| Fila de revisão com atalhos | RF-28 | Fluxo inteiro só pelo teclado (teste e2e) |
| Perfil de gosto editável + assinaturas | RF-29, RNF-10, RF-38 (declaração) | Override reflete no ranking (teste) |
| Sandbox: fixtures, execução, evals | RF-19, RF-22 | Rodar fixture e ver o diff com `expected.json` |

Dependências: 2a; endpoints de catálogo/listas da 2b.

## Fase 2d: recomendação

| Entregável | Requisitos | Critério de saída |
|---|---|---|
| `POST /recommend` (continue/surprise/mood) + `recommendation_runs` | RF-31..33, RF-39 | Runs auditáveis no sandbox; texto livre nunca persistido (teste) |
| Opt-in de humor, "lembrar humor" e apagar histórico | RNF-06 | Testes de persistência zero |
| Ranking determinístico + Explainer por template | RF-35, RF-36 | Mesma entrada → mesma saída; todo item com `reason` |
| Feedback + perfil incremental + rebuild | RF-34, RF-37 | Incremental ≡ rebuild (teste de propriedade) |
| Disponibilidade BR (assinaturas + providers TMDB) | RF-38 | Boost aplicado; atribuição TMDB visível (TOS-REQ-01) |
| `AnthropicInterpreter` (modelo pequeno, schema estrito, fallback `rules`) — **pronto e desligado** | RF-33, RNF-08, RNF-09 | Com PRE-02: fixtures de intenção e de injeção passam; custo por run no relatório |
| Candidatos externos (TMDB discover/keywords/similar) | RF-32 (K), RF-35 | Só depois da PRE-01 **e** da PRE-04 |

Dependências: 2a (taxonomia, detector, `rules`), 2b/2c (superfícies). A IA real depende da PRE-02; a descoberta externa, da PRE-01 + PRE-04.

## Situação por modo de IA

| `AI_MODE` | Quando | O que funciona |
|---|---|---|
| `off` | Padrão em SC-STORE até a PEND-10 | Continuar + Surpreenda (presets R/K); "Como estou" oculto |
| `rules` | **Padrão em SC-PERSONAL** enquanto não houver chave Anthropic | Tudo, com interpretação local do humor |
| `anthropic` | SC-PERSONAL com PRE-02 (D-06) | Interpretação por LLM (modelo pequeno) + tag L de subgênero só com título/ano |
