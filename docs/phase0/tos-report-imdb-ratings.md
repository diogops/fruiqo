# Relatório de ToS — Nota geral do IMDb (rating médio + votos)

Agente: `tos-compliance-auditor`. Data de acesso a todas as fontes: **2026-09-30**.

Escopo: avaliar se o Fruiqo pode obter e exibir a **nota geral do IMDb** (`averageRating`/`numVotes`, equivalente ao "rating" que aparece na página do título no IMDb) em **SC-PERSONAL** (1 usuário, uso pessoal e não comercial, web na Vercel + API no Railway, dados no Postgres), com registro do que mudaria em **SC-STORE**. Contexto lido: `CLAUDE.md`, `docs/phase0/decisions.md` (D-17, D-20), `docs/phase0/decision-matrix.md` (linha P-TMDB "Link de saída para imdb.com", PND-34, C-15/D-17 sobre TMDB × IA).

Isto não é um parecer jurídico. É um mapeamento de cláusulas para decisão técnica, com a regra fail-closed: sem evidência oficial clara → tratado como proibido.

---

## 1. Tabela de status por fonte

| Fonte | SC-PERSONAL | SC-STORE | Custo | Exibir a nota ao usuário |
|---|---|---|---|---|
| 1. IMDb Non-Commercial Datasets (`title.ratings.tsv.gz`) | `AMBÍGUO` (ver §2.1) | `PROIBIDO` | Gratuito | Ambíguo em SC-PERSONAL; proibido em SC-STORE |
| 2. OMDb API (chave gratuita ou Patreon) | `PROIBIDO` | `PROIBIDO` | Gratuito (1000 req/dia) ou pago (Patreon, valor não verificado) | Proibido nos dois cenários |
| 3. IMDb API oficial via AWS Data Exchange | `NÃO VERIFICADO` → tratado como proibido pelo custo, não pela cláusula | `NÃO VERIFICADO` | US$ 150.000/12 meses (tier "Essential") + uso medido | Seria permitido via contrato, mas inviável por custo |
| 4. TMDB `vote_average`/`vote_count` (já em uso) | `PERMITIDO COM CONDIÇÃO` (herda D-17: `TMDB_AI_CLEARANCE=confirmed` só no ambiente pessoal) | `BLOQUEADO` (herda o mesmo bloqueio de todo o P-TMDB em SC-STORE até resposta escrita do TMDB, D-17) | Gratuito | Permitido, com as condições já existentes (TOS-REQ-01/02/03/04) |

**Recomendação de fonte**: manter **TMDB `vote_average`/`vote_count`** como a nota exibida (fonte 4). Nenhuma das fontes específicas de IMDb (1, 2, 3) está liberada hoje, nem em SC-PERSONAL.

---

## 2. Análise por fonte

### 2.1 IMDb Non-Commercial Datasets

Fontes oficiais:
- https://developer.imdb.com/non-commercial-datasets/ (redireciona 301 para `https://data.imdb.com/non-commercial-datasets/`) — acessado em 2026-09-30.
- https://data.imdb.com/non-commercial-datasets/ — acessado em 2026-09-30.
- https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX — acessado em 2026-09-30.
- https://www.imdb.com/conditions ("IMDb Conditions of Use") — acessado em 2026-09-30.

**O que é permitido:**
- A página oficial confirma que o arquivo `title.ratings.tsv.gz` traz exatamente os dois campos pretendidos: "averageRating – weighted average of all the individual user ratings" e "numVotes – number of votes the title has received". Atualização: "the data is refreshed daily" em `datasets.imdbws.com`.
- O artigo de ajuda do IMDb autoriza "personal and non-commercial" use dos datasets, e as Conditions of Use permitem "personal and non-commercial use" dos "IMDb Services", incluindo uma licença "limited, non-exclusive, non-transferable, non-sublicenseable".
- As Conditions of Use permitem explicitamente "page caching" ("not to download (other than page caching)... except with express written consent"), mas isso se refere ao site `imdb.com`, não ao dataset em si — o próprio texto do dataset já é um download em massa autorizado, distinto de "page caching".

**O que é proibido:**
- Uso comercial: "may not be reproduced, duplicated, copied, sold, resold, visited, or otherwise exploited for any commercial purpose without express written consent" (Conditions of Use).
- Segundo o artigo de ajuda, o dado "não pode ser alterado/republicado/revendido/reaproposto para criar qualquer tipo de banco de dados online/offline, exceto para uso pessoal individual" (paráfrase de "altered/republished/resold/repurposed to create any kind of online/offline database" except for individual personal use).
- Atribuição exigida quando o uso é permitido: o artigo de ajuda pede a frase "Information courtesy of IMDb (https://www.imdb.com). Used with permission." — atenção: essa frase afirma que o uso **é** autorizado ("used with permission"); usá-la sem de fato ter contatado o IMDb e obtido permissão explícita para o caso de uso do Fruiqo é, por si, um risco (declaração falsa de licenciamento).
- Data mining/scraping do site `imdb.com` é proibido ("data mining, robots, screen scraping, or similar... data gathering and extraction tools"), mas isso não se aplica ao download do dataset oficial em `datasets.imdbws.com`, que é um canal distinto e autorizado.

**Ponto ambíguo (por que SC-PERSONAL fica `AMBÍGUO`, não `PERMITIDO`):**
- Duas leituras possíveis do trecho "reaproposto para criar qualquer banco de dados... exceto para uso pessoal individual":
  - **Leitura restritiva**: importar `averageRating`/`numVotes` para uma tabela do Postgres do Fruiqo — mesmo que só 1 usuário a use — já é "criar um banco de dados" derivado do dataset, e um backend hospedado no Railway/Vercel (acessível fora do computador do usuário, ainda que só ele tenha login) deixa de ser um uso estritamente "individual" no sentido pretendido pelo IMDb (que parece mirar scripts locais, não um serviço implantado, mesmo que de um usuário só).
  - **Leitura permissiva**: como o Fruiqo em SC-PERSONAL tem exatamente 1 titular, sem distribuição a terceiros, sem revenda e sem fins comerciais, o armazenamento das notas no Postgres cumpriria "uso pessoal individual" e a nota exibida a esse único usuário não constitui "criar um banco de dados" no sentido de produto de dados a terceiros.
  - Nenhuma das duas páginas oficiais distingue explicitamente "script local" de "serviço implantado de um único usuário", então a ambiguidade é real, não uma leitura forçada.
- Além disso, a exigência de atribuição "used with permission" pressupõe permissão de fato concedida, o que o Fruiqo não tem (nenhum contato foi feito com o IMDb).
- Pela regra fail-closed do método (cláusula ambígua → `AMBÍGUO`, não suavizado para `PERMITIDO`), a fonte 1 fica `AMBÍGUO` em SC-PERSONAL e **tratada como proibida até resolução** (mesmo critério que o `phase0-arbiter` já aplica a outros itens `AMBÍGUO`/`NÃO VERIFICADO` na matriz de decisão, critério 2 de `decision-matrix.md`).

**SC-STORE:**
- Uso comercial é proibido de forma explícita e sem exceção nas Conditions of Use ("may not be... exploited for any commercial purpose without express written consent"); um app distribuído em loja, mesmo gratuito, tende a ser lido como exploração além do uso "pessoal individual" assim que há usuários além do titular. `PROIBIDO`.

Trechos parafraseados, com data de acesso 2026-09-30:
> "The data is refreshed daily." — `data.imdb.com/non-commercial-datasets/`
> "averageRating – weighted average of all the individual user ratings"; "numVotes – number of votes the title has received" — idem
> "A limited, non-exclusive, non-transferable, non-sublicenseable license to access and make personal and non-commercial use of the IMDb Services" — `imdb.com/conditions`
> "May not be reproduced, duplicated, copied, sold, resold, visited, or otherwise exploited for any commercial purpose without express written consent" — idem
> "You may not use data mining, robots, screen scraping, or similar data gathering and extraction tools on this site, except with our express written consent" — idem
> Paráfrase do artigo de ajuda: dado não pode ser alterado/republicado/revendido/reaproposto para criar banco de dados online/offline, exceto uso pessoal individual; atribuição sugerida "Information courtesy of IMDb (https://www.imdb.com). Used with permission." — `help.imdb.com/.../G5JTRESSHJBBHTGX`

### 2.2 OMDb API (omdbapi.com)

Fontes oficiais:
- https://www.omdbapi.com/ — acessado em 2026-09-30.
- https://www.omdbapi.com/legal.htm — acessado em 2026-09-30.
- https://www.omdbapi.com/apikey.aspx — acessado em 2026-09-30.

**O que a página oferece:**
- Chave de API gratuita com limite de "1,000 daily limit" de requisições, mais um plano "Patreon" pago (limite mais alto; valor exato **não verificado** — a página do Patreon retornou HTTP 403 ao fetch automatizado).
- O changelog do próprio site cita "FREE KEYS!" e uma "Poster API" exclusiva do plano pago.

**O que é proibido (página `legal.htm`):**
- Uso apenas "solely for personal, non-commercial purposes" — mesma restrição de não comercialidade do IMDb.
- Proibição explícita de uso comercial: "You may not build a business utilizing the Contributions, whether or not for profit."
- Proibição de cache/redistribuição: "copy, download, reproduce, duplicate, archive, distribute, upload, publish, modify, translate, broadcast" o conteúdo, exceto o uso pessoal permitido; proibição explícita de screen scraping.
- Proibição de obras derivadas: "derivative works or materials that otherwise are derived from or based on Contributions".
- Proibição de indexação: "create, recreate, distribute or advertise an index of any Contributions unless authorized... in writing."
- A página inicial do OMDb também declara (achado em pesquisas anteriores de mercado, não citado literalmente aqui por não ter sido capturado no fetch) que o serviço **não é afiliado, endossado ou autorizado pelo IMDb/Amazon** — ou seja, o próprio OMDb reconhece não ter uma licença repassada de dados do IMDb; a licença de uso é da OMDb sobre o conteúdo que ela compila, sob CC BY-NC 4.0.

**Por que `PROIBIDO` mesmo em SC-PERSONAL:**
- Diferente do IMDb, aqui não há a ressalva de "uso pessoal individual" para criar uma cópia/índice: a cláusula de indexação veda expressamente "criar, recriar, distribuir ou anunciar um índice de quaisquer Contribuições" sem autorização por escrito. Persistir `averageRating`/`numVotes` de múltiplos títulos no Postgres do Fruiqo, para ordenar/filtrar o catálogo do usuário, é funcionalmente um índice das Contribuições da OMDb — a leitura literal do texto não deixa margem para a leitura permissiva que existe no caso do IMDb. Cache além do uso instantâneo de exibição também está vedado pela cláusula de "archive/distribute".
- A licença CC BY-NC 4.0, ainda que aplicável ao "conteúdo licenciado", coexiste com a cláusula contratual de `legal.htm`, que é mais restritiva (proíbe até indexação e "building a business", independente de fins lucrativos). Como o texto de `legal.htm` é mais específico e recente que a licença de rodapé, ele prevalece na leitura fail-closed.
- Não há atribuição suficiente que resolva essas proibições: a cláusula não é "pode usar com atribuição", é "pode usar só como consumo pessoal instantâneo, sem cache/índice".

**SC-STORE:** as mesmas cláusulas de uso não comercial e vedação de indexação tornam a fonte `PROIBIDO` de forma ainda mais direta, pois SC-STORE é por definição uso além do "pessoal".

### 2.3 IMDb API oficial via AWS Data Exchange

Fontes:
- https://aws.amazon.com/marketplace/pp/prodview-wdqq4hg3bcbws (IMDb Essential Metadata) — pesquisa web, não lido integralmente via fetch (fonte secundária de agregador para o valor; ver nota abaixo).
- https://help.imdb.com/article/imdb/general-information/introducing-the-imdb-api/G49M5Y59L5N4WABM — acessado em 2026-09-30.

**O que é oficial e verificado:**
- O artigo oficial do IMDb confirma que a "IMDb API" está disponível via **AWS Data Exchange**, com uma oferta gratuita de avaliação ("free trial requests") e suporte dedicado por `imdb-licensing@imdb.com`. A API é baseada em GraphQL, com payloads JSON, chamadas em lote e seleção de campos.
- O artigo não afirma explicitamente que os campos de rating/votos estão incluídos; cita "Movie, TV/OTT, Box Office data and more" (runtimes, prêmios, etc.), então a presença de `averageRating`/`numVotes` neste produto **não está confirmada por fonte primária**.

**Custo — nota de proveniência:** o valor de "US$ 150.000 por 12 meses" para o tier "IMDb Essential Metadata for Movies/TV/OTT" e "US$ 400.000" para o tier com Box Office Mojo vêm de uma busca web agregada (`api.market`, `cloudzero.com`), não de uma leitura direta e confirmada da página oficial do AWS Marketplace pelo agente. Tratar como **fonte secundária**, mas suficiente para a conclusão prática: mesmo que o valor exato varie, a ordem de grandeza (contrato anual de dezenas a centenas de milhares de dólares, cobrança por uso medido) é incompatível com um app pessoal, sem monetização (D-02).

**Status:** `NÃO VERIFICADO` quanto à cláusula exata de uso (não há termos específicos lidos além da confirmação de existência do canal), e a via fica **inviável por custo** para SC-PERSONAL e SC-STORE nas condições atuais do produto — mesmo que a cláusula contratual fosse favorável, o gate econômico já barra a fonte. Registrado como pendência, não como "proibido por ToS".

### 2.4 Alternativa já permitida: TMDB `vote_average`/`vote_count`

Já coberta em `docs/phase0/tos-report.md` (linhas TOS-REQ-01 a 04) e revisitada em `docs/phase0/decision-matrix.md` (D-17): TMDB permite uso do "TMDB Content" (que inclui os campos de rating agregado do próprio TMDB, não do IMDb) sob a mesma licença já usada para busca e watch providers, com:
- Atribuição obrigatória (logo + "This product uses the TMDB API but is not endorsed or certified by TMDB.").
- TTL de cache ≤ 6 meses.
- Proibição de treinar/alimentar modelo de IA com esse dado (TOS-REQ-03/39; nenhum dado do TMDB pode ir ao LLM, ARB-REQ-06).
- Uso comercial exige acordo escrito (TOS-REQ-04), relevante só se D-02 mudar.

Isso já é `PERMITIDO COM CONDIÇÃO` em SC-PERSONAL — mas herda o bloqueio geral do P-TMDB enquanto a premissa "não somos uma AI based Application" (Seção 1.C) não estiver resolvida por escrito para o ambiente de produção (D-17: a resolução vale hoje só para o ambiente pessoal local com `TMDB_AI_CLEARANCE=confirmed`; produção no Railway foi estendida pela D-20, então a mesma condição de D-17/D-20 se aplica aqui, sem necessidade de nova análise: a nota TMDB não é um uso novo de API, é o mesmo campo já coberto pela avaliação existente).

**Diferença semântica a registrar:** `vote_average`/`vote_count` do TMDB **não é a nota do IMDb**. São bases de votação diferentes (comunidade do TMDB vs. comunidade do IMDb), com valores tipicamente diferentes para o mesmo título. Se o produto quer especificamente "a nota do IMDb" (ex.: para bater com a expectativa do usuário que já conhece o número do IMDb), a nota do TMDB é uma alternativa **funcionalmente próxima, mas não idêntica** — isso é uma decisão de produto, não de ToS, e cabe ao `phase0-arbiter`/dono do produto decidir se a diferença é aceitável.

---

## 3. Requisitos derivados

| ID | Requisito | Origem | Escopo |
|---|---|---|---|
| TOS-REQ-70 | Não usar a OMDb API para obter, cachear ou indexar ratings/votos: a cláusula de indexação e a vedação de "building a business" tornam qualquer uso além de uma consulta pessoal instantânea proibido. | OMDb `legal.htm` | Ambos |
| TOS-REQ-71 | Não importar/persistir `title.ratings.tsv.gz` do IMDb Non-Commercial Datasets em produção (Railway/Postgres) enquanto a leitura de "uso pessoal individual" não for confirmada com o IMDb (contato com `imdb-licensing@imdb.com` ou Content Licensing) ou por parecer jurídico; se confirmada só para SC-PERSONAL, manter fora de SC-STORE de qualquer forma. | IMDb Conditions of Use + artigo de ajuda | Ambos (bloqueio até confirmação) |
| TOS-REQ-72 | Não usar a frase de atribuição sugerida pelo IMDb ("Used with permission") sem ter de fato solicitado e recebido essa permissão por escrito. | IMDb artigo de ajuda | Ambos |
| TOS-REQ-73 | Não contratar a IMDb API via AWS Data Exchange sem antes confirmar (a) que o produto inclui `averageRating`/`numVotes` e (b) que o custo é compatível com D-02 (sem monetização); hoje, tratar como fora de escopo por custo. | AWS Data Exchange / artigo "Introducing the IMDb API" | Ambos |
| TOS-REQ-74 | Manter a exibição de nota geral apoiada em `vote_average`/`vote_count` do TMDB, sob as mesmas condições já vigentes do P-TMDB (TOS-REQ-01/02/03/04, D-17/D-20), sem tratar isso como uma nova integração que precise de nova aprovação de escopo. | TMDB API Terms of Use (já coberto) | Ambos |
| TOS-REQ-75 | Se decidir buscar a nota do IMDb no futuro, priorizar contato formal com o IMDb Content Licensing (`imdb.com/licensing/`) antes de qualquer implementação, em vez de assumir a leitura permissiva do dataset não comercial. | IMDb Conditions of Use | Ambos |

---

## 4. Pendências

| Pendência | Item afetado | O que resolveria |
|---|---|---|
| PEND-IMDb-01 | Ambiguidade da fonte 1 em SC-PERSONAL (§2.1) | Contato com `imdb-licensing@imdb.com` perguntando explicitamente se um backend pessoal (Railway/Vercel, 1 usuário, sem receita) hospedando os campos `averageRating`/`numVotes` do dataset não comercial se enquadra em "uso pessoal individual"; alternativa: parecer jurídico sobre a mesma questão. |
| PEND-IMDb-02 | Valor de custo da fonte 3 não confirmado por fonte primária (§2.3) | Ler diretamente a página do AWS Marketplace (`aws.amazon.com/marketplace/pp/prodview-wdqq4hg3bcbws`) e confirmar se os campos de rating estão no escopo do produto "Essential Metadata". Dado o valor já indicado (seis dígitos/ano), a prioridade dessa verificação é baixa. |
| PEND-IMDb-03 | Valor exato do tier Patreon da OMDb (§2.2) | Não é decisivo (a fonte já está `PROIBIDO` pela cláusula de indexação/negócio, independente do preço), mas registrar se o produto quiser reavaliar no futuro. |

---

## 5. Resumo para o pedido

- **Fonte recomendada agora**: manter a nota exibida como `vote_average`/`vote_count` do **TMDB**, já `PERMITIDO COM CONDIÇÃO` em SC-PERSONAL pelas mesmas regras que já regem o restante do P-TMDB (atribuição, TTL de 6 meses, proibição de uso em LLM). Não é a nota do IMDb, é uma métrica equivalente de outra comunidade.
- **Nenhuma das três fontes específicas de IMDb pode entrar já, nem em SC-PERSONAL**: o dataset não comercial fica `AMBÍGUO` (proibido até prova em contrário, pela regra fail-closed), a OMDb API fica `PROIBIDO` pela cláusula de indexação/uso comercial dos seus termos, e a IMDb API via AWS Data Exchange é inviável por custo (dezenas a centenas de milhares de dólares por ano), além de não ter a inclusão de rating confirmada.
- Se a nota literal do IMDb for um requisito não negociável do produto, o caminho mais barato e menos arriscado é abrir contato formal com o IMDb Content Licensing antes de qualquer implementação (PEND-IMDb-01), não presumir a leitura permissiva do dataset gratuito.

Este relatório não constitui parecer jurídico.
