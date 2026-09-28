# Tarefa: expandir o escopo com simulador, sistema web e recomendação inteligente

## Contexto
Este prompt amplia o escopo do projeto do app de catálogo de mídia (filmes, séries e músicas extraídos de Instagram, PDFs, imagens e listas). A Fase 0 (discovery de ToS, segurança e conectividade) continua valendo e **não foi aprovada ainda**. Nada aqui autoriza implementação.

Stack candidata (pendente da Fase 0): Expo (React Native) no mobile, NestJS + BullMQ + Postgres no Railway, Anthropic API no backend.

## Objetivos novos

| ID | Objetivo | Resumo |
|---|---|---|
| OBJ-01 | Simulador / sandbox | Poder ver as telas do app e testar o pipeline (extração, OCR, detecção, resolução e catalogação) sem device físico e sem depender das integrações reais |
| OBJ-02 | Sistema web de organização | Interface desktop para organizar o catálogo com mais conforto que no celular |
| OBJ-03 | Recomendação inteligente | A IA entende gostos e o momento do usuário e sugere o que assistir/ouvir |

### Divisão de responsabilidades

| Superfície | Papel |
|---|---|
| App mobile | Uso do dia a dia: receber shares, disparar OCR/extração, decidir o que assistir agora, abrir no streaming |
| Sistema web | Organização: edição em massa, catálogo, listas, activity log detalhado, revisão de extrações, perfil de gosto |
| Sandbox (dev) | Validação: simular shares, inspecionar cada etapa do pipeline, rodar fixtures |

## Requisitos novos

### Simulador / sandbox (OBJ-01)

| ID | Requisito |
|---|---|
| RF-17 | **Preview das telas**: o app mobile roda no navegador (Expo web) e em emulador Android/iOS, com dados de seed realistas. |
| RF-18 | **Simulador de share**: tela de dev que emula o share sheet. Aceita URL, texto, upload de imagem/PDF e seleção de fixture, e injeta o conteúdo no mesmo ponto de entrada do share real. |
| RF-19 | **Pipeline inspector**: para cada `IngestionJob`, mostra cada etapa com entrada, saída, duração, custo estimado (tokens) e erros: conteúdo bruto → texto extraído/OCR → candidatos detectados → matches com `confidence_score` → decisão (catalogado / fila de revisão / descartado). |
| RF-20 | **Modos de execução** via `PIPELINE_MODE`: `mock` (respostas gravadas, custo zero), `live` (APIs reais) e `record` (chama as APIs reais e grava as respostas como fixtures para o `mock`). |
| RF-21 | **Fixtures versionadas** em `fixtures/`: screenshots de posts, PDFs de listas e textos colados, cada um com o resultado esperado (`expected.json`). |
| RF-22 | **Avaliação automática**: comando que roda todas as fixtures e gera um relatório de precision/recall da detecção de títulos e acerto da resolução, para comparar versões de prompt e modelo. |
| RF-23 | **Mocks de streaming**: deep links e ações do Spotify simulados no modo `mock`, com log do que seria enviado. |

### Sistema web (OBJ-02)

| ID | Requisito |
|---|---|
| RF-24 | Catálogo em tabela com filtros (tipo, gênero, status, prioridade, lista, fonte), ordenação e busca. |
| RF-25 | Edição em massa: mover itens entre listas, mudar gênero/prioridade/status e remover. |
| RF-26 | Listas: criar, renomear, reordenar itens (drag-and-drop), duplicar. |
| RF-27 | Activity log detalhado, com o mesmo conteúdo do pipeline inspector, mais a correção de matches errados direto da tela. |
| RF-28 | Fila de revisão: aprovar, rejeitar ou trocar o match de candidatos com baixa confiança, com atalhos de teclado. |
| RF-29 | Perfil de gosto (ver RF-33) visível e editável. |
| RF-30 | Mesma autenticação e mesma API do app. Nenhuma lógica de negócio duplicada no frontend. |

### Recomendação inteligente (OBJ-03)

Ao abrir o app, a home oferece três caminhos:

| ID | Modo | Comportamento |
|---|---|---|
| RF-31 | **Continuar** | Retoma a lista/maratona em andamento, respeitando a priorização. Mostra o próximo item e o progresso. |
| RF-32 | **Surpreenda-me** | O usuário escolhe um gênero ou subgênero (ex.: comédia romântica, comédia pastelão, thriller psicológico) e o sistema sugere. Subgêneros não existem como gênero no TMDB: usar keywords do TMDB e/ou tagging por LLM, com taxonomia própria versionada. |
| RF-33 | **Como estou** | Texto livre (ex.: "estou triste, sofrendo por amor"). O sistema interpreta a intenção e a necessidade emocional (ex.: quer algo inspirador, sobre superação, que não gire em torno de romance) e sugere conteúdo alinhado. |

Regras comuns aos três modos:

| ID | Regra |
|---|---|
| RF-34 | **Perfil de gosto** construído a partir de: itens assistidos/ouvidos, avaliações (like/dislike ou nota), itens pulados/removidos, gêneros e listas. Atualizado de forma incremental. |
| RF-35 | **Prioridade de fontes**: primeiro o catálogo do próprio usuário (`to_watch`), depois descoberta externa (TMDB/Spotify), sempre sinalizada como "fora da sua lista". |
| RF-36 | **Explicabilidade**: toda sugestão vem com uma frase de "por que isso" (ex.: "história de recomeço, tom leve, parecido com X que você curtiu"). |
| RF-37 | **Feedback**: o usuário pode aceitar, pular ou pedir "outra coisa" e dizer por quê em uma palavra ("pesado demais"). O feedback alimenta o perfil (RF-34). |
| RF-38 | **Disponibilidade**: priorizar o que está disponível nos streamings conectados do usuário na região BR. |
| RF-39 | **Pipeline de recomendação** em etapas auditáveis: interpretação da intenção (LLM, saída por schema) → geração de candidatos (catálogo + TMDB discover/keywords + similares) → ranking (perfil + intenção + disponibilidade) → explicação. Cada execução fica registrada e visível no sandbox (RF-19). |

## Requisitos não funcionais novos

| ID | Requisito |
|---|---|
| RNF-06 | **Texto do "Como estou" é dado sensível**: opt-in explícito; o texto livre não é persistido por padrão, só a intenção estruturada (ex.: `mood: sad, need: uplifting, avoid: romance`); o usuário pode apagar o histórico de humor. Avaliar enquadramento na LGPD. |
| RNF-07 | **Mensagens de sofrimento intenso**: se o texto indicar risco (ex.: ideação suicida, autolesão), o sistema não trata aquilo como pedido de filme. Exibe uma mensagem acolhedora com o CVV (188, cvv.org.br) e só depois oferece continuar. A detecção é conservadora e tem casos de teste próprios nas fixtures. |
| RNF-08 | **Prompt injection**: o texto do "Como estou" e o conteúdo compartilhado são entrada não confiável; o LLM não tem ferramentas nem ações, e a saída é validada por schema. |
| RNF-09 | **Custo**: o modo "Como estou" usa um modelo menor para interpretar a intenção, e o ranking é determinístico sempre que possível. Estimar custo por recomendação no sandbox. |
| RNF-10 | **Perfil transparente**: o usuário vê o que o sistema acha dos gostos dele e pode corrigir (ex.: remover "terror" do perfil). Nenhuma inferência escondida. |

## Impacto na Fase 0
Antes de tudo, proponha (sem aplicar) as alterações cirúrgicas necessárias:

| Arquivo | Alteração esperada |
|---|---|
| `docs/phase0/platforms.md` | Adicionar RF-32/RF-33/RF-35/RF-38 às capacidades de P-TMDB (discover, keywords, recommendations, watch providers) e P-SPOT (recommendations/busca). Adicionar P-LLM para RF-33/RF-39. |
| `.claude/agents/tos-compliance-auditor.md` | Checar se os termos do TMDB e do Spotify permitem usar os dados em recomendação e enviá-los a um LLM; enquadramento LGPD do dado de humor. |
| `.claude/agents/security-threat-modeler.md` | Incluir os fluxos F-10 (modo "Como estou") e F-11 (sistema web), prompt injection no texto de humor e o tratamento de RNF-07. |

## Entregáveis desta etapa (somente spec, sem código)

| # | Entregável | Local |
|---|---|---|
| 1 | Delta de requisitos (RF-17 a RF-39, RNF-06 a RNF-10), com critérios de aceite verificáveis para cada um | `docs/spec/delta-v2.md` |
| 2 | Arquitetura atualizada: monorepo (`apps/mobile`, `apps/web`, `apps/api`, `apps/worker`, `packages/shared`), recomendação de framework para o web (Next.js vs Expo web), com trade-offs | `docs/spec/architecture-v2.md` |
| 3 | Modelo de dados com as entidades novas (ex.: `TasteProfile`, `TasteSignal`, `RecommendationRun`, `RecommendationFeedback`, `MoodIntent`, `Fixture`, `EvalRun`) | mesmo arquivo |
| 4 | Diagramas de sequência (Mermaid): share → catálogo; "Como estou" → sugestão; execução de fixture no sandbox | mesmo arquivo |
| 5 | Wireframes em texto/ASCII ou Mermaid das telas: home do app com os 3 modos, resultado de recomendação, pipeline inspector, catálogo web, fila de revisão web | `docs/spec/wireframes-v2.md` |
| 6 | Taxonomia inicial de subgêneros e de intenções de humor (ex.: `need: uplifting / comfort / catharsis / distraction`), versionada | `docs/spec/taxonomy-v1.md` |
| 7 | Plano de fases atualizado, com esta sugestão de ordem: Fase 2a = sandbox + pipeline + fixtures (valida OCR e extração antes de qualquer tela bonita); Fase 2b = app mobile básico; Fase 2c = sistema web; Fase 2d = recomendação | `docs/spec/phases-v2.md` |

## Regras
- Spec-first: **não escreva código de implementação** nesta etapa.
- Prosa em português; identificadores, entidades e endpoints em inglês.
- Tabelas densas em vez de prosa longa.
- Fail-closed: o que depender de plataforma ainda não validada na Fase 0 fica marcado como `DEPENDE DA FASE 0`.
- Alterações nos agentes e no `platforms.md`: mostre o diff e aguarde aprovação antes de salvar.
- Se houver ambiguidade que mude a arquitetura, faça no máximo 5 perguntas objetivas antes de começar.
- Ao final, pare com: `CHECKPOINT: aguardando aprovação do delta v2.`
