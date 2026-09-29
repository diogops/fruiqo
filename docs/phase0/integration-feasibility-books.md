# Viabilidade técnica de integração — Livros (rodada complementar) — Fase 0

Agente: `integration-feasibility-scout`. Data de acesso: **2026-09-28**. Escopo: candidatos para o tema Livros — **Open Library** (`P-OL`, proposto) e **Google Books API** (`P-GB`, proposto). Nenhum dos dois consta em `docs/phase0/platforms.md` hoje; registrados aqui a pedido explícito desta rodada. Se o escopo de livros for confirmado, o `phase0-arbiter`/dono do produto deve incluir `P-OL`/`P-GB` em `platforms.md` com RFs próprios (não há RF de livros numerado ainda; as capacidades abaixo são análogas a RF-05/RF-06 de busca/metadados de outras mídias).

Regra aplicada: toda afirmação tem URL oficial + data de acesso, ou evidência de spike (`docs/phase0/spikes/spike-17-books.sh`). Sem evidência → `NÃO VERIFICADO`, tratado como inviável até prova em contrário. Todos os spikes desta rodada são `GET` públicos, documentados, **sem nenhuma API key** (nem `TMDB_API_KEY` nem qualquer chave de Google foi usada).

---

## 1. Resumo

| Platform ID | Melhor mecanismo disponível | Auth | Viabilidade SC-PERSONAL | Viabilidade SC-STORE | Principal limitação |
|---|---|---|---|---|---|
| P-OL (Open Library) | REST `search.json` (busca) + `works/{id}.json` (sinopse) + `covers.openlibrary.org` (capa) + `isbn/{isbn}.json` | Nenhuma (User-Agent identificado recomendado, não obrigatório) | **VIÁVEL** | **VIÁVEL** | Título canônico do "work" costuma ficar no idioma original (ex.: obra internacional aparece como "Le petit prince"/"Nineteen Eighty-Four", não no título em PT-BR); `subject` é texto livre multilíngue e sem taxonomia fixa de gênero; catálogo é editável pela comunidade (qualidade de sinopse/capa varia por obra); sem SLA formal, rate limit baixo para uso em lote (1–3 req/s) |
| P-GB (Google Books) | REST `volumes` (list/get) | Nenhuma para "uso leve", segundo a doc — **na prática, hoje, o acesso sem chave está de fato inoperante** (ver spike) | **VIÁVEL COM LIMITAÇÃO** (precisa de chave gratuita do Google Cloud, não testada nesta rodada) | **VIÁVEL COM LIMITAÇÃO** (idem + quota numérica real não é documentada publicamente, só visível no Console após criar o projeto) | Confirmado por spike: toda chamada sem `key=` retornou **HTTP 429** com `quota_limit_value: "0"` para o "consumer" anônimo compartilhado — a doc diz que a chave "não é estritamente necessária", mas o comportamento real em 2026-09-28 é de cota zerada para o pool anônimo global |

---

## 2. Detalhe por capacidade

| Platform ID | Capacidade | Mecanismo | Endpoint | Auth | Quota/limite | Pré-req. usuário | BR/PT | Fonte/spike | Acessado em |
|---|---|---|---|---|---|---|---|---|---|
| P-OL | Busca por título | `search.json` | `GET https://openlibrary.org/search.json?q=...&language=por&fields=...` | Nenhuma | 1 req/s (sem User-Agent identificado) / 3 req/s (com) | Nenhum | Sim — `language=por` filtra/prioriza edições em português | **SPIKE-17**; openlibrary.org/dev/docs/api/search; openlibrary.org/developers/api | 2026-09-28 |
| P-OL | Busca por título+autor | `search.json` (`q="Título Autor"`) | idem | Nenhuma | idem | Nenhum | Sim | **SPIKE-17**: 5/5 BR + 3/3 internacionais retornaram o livro correto como primeiro ou único resultado (ex.: "Torto Arado"/"Ainda Estou Aqui" com `numFound=1`) | 2026-09-28 |
| P-OL | Busca por ISBN | `GET /isbn/{isbn}.json` (redireciona para a edição) ou `q=isbn:{isbn}` | `GET https://openlibrary.org/isbn/{isbn}.json` | Nenhuma | idem | Nenhum | Sim | **SPIKE-17b**: HTTP 200, JSON de edição real retornado (ver nota de qualidade abaixo) | 2026-09-28 |
| P-OL | Sinopse/descrição | `works/{id}.json`, campo `description.value` (texto wiki, editável pela comunidade) | `GET https://openlibrary.org/works/OL24141556W.json` | Nenhuma | idem | Nenhum | Variável — no teste ("Torto Arado") a sinopse veio em português, 1211 caracteres | Spike ad hoc desta rodada (não salvo em arquivo separado; mesmo padrão do SPIKE-17) | 2026-09-28 |
| P-OL | Capa | Covers API | `https://covers.openlibrary.org/b/id/{cover_i}-L.jpg` (ou por ISBN/OLID) | Nenhuma | **100 req/IP/5 min** para chave ≠ CoverID/OLID (403 se exceder); doc pede para não fazer crawling em massa | Nenhum | Sim | openlibrary.org/dev/docs/api/covers | 2026-09-28 |
| P-OL | Gêneros/assuntos | Campo `subject` (search) / Subjects API (`/subjects/{nome}.json`, "experimental") | `GET https://openlibrary.org/subjects/fiction.json` | Nenhuma | Não documentada | Nenhum | Parcial — mistura termos em inglês (LCSH) e português livre (ex.: "Romance brasileiro" apareceu junto com termos em inglês no mesmo `subject[]`) | **SPIKE-17**; openlibrary.org/dev/docs/api/subjects | 2026-09-28 |
| P-OL | Páginas/idioma | Campos `number_of_pages_median`, `language[]` (lista de códigos ISO 639-2 de todas as edições do work) | idem `search.json` | Nenhuma | idem | Nenhum | Sim | **SPIKE-17** | 2026-09-28 |
| P-OL | Link público ("onde encontrar") | Página do work no próprio site | `https://openlibrary.org{key}` onde `key` vem de `search.json` (ex.: `/works/OL24141556W`) | Nenhuma | idem | Nenhum | Sim | Spike ad hoc (campo `key` confirmado no `search.json`) | 2026-09-28 |
| P-GB | Busca por título / título+autor / ISBN | `volumes.list` com `q=`, `intitle:`, `inauthor:`, `isbn:` | `GET https://www.googleapis.com/books/v1/volumes?q=...` | Nenhuma (doc) / **na prática exige chave hoje** | Doc não publica número fixo; Console mostra quota por projeto após criar chave (relatos de terceiros: ~1000/dia no tier gratuito — não é doc oficial, ver pendência) | Nenhum | `country=BR` documentado para respeitar restrições de território, não confirmado seu efeito na qualidade do match (todas as chamadas de teste retornaram 429 antes de produzir resultado) | **SPIKE-17**: **HTTP 429** em todas as 8 tentativas + na tentativa por ISBN, corpo `"Quota exceeded ... Queries per day ... quota_limit_value":"0"`; developers.google.com/books/docs/v1/using; developers.google.com/books/docs/v1/reference/volumes/list | 2026-09-28 |
| P-GB | Sinopse, capa, categorias, páginas, ISBN, idioma | Campos `volumeInfo.description/imageLinks/categories/pageCount/industryIdentifiers/language` | idem | idem | idem | Nenhum | Documentado, **não confirmado por spike** nesta rodada (429 antes de obter corpo com dados) | developers.google.com/books/docs/v1/using — **NÃO EXECUTADO por cota, não por falta de tentativa** | 2026-09-28 |
| P-GB | Link público ("onde encontrar") | `volumeInfo.infoLink`/`canonicalVolumeLink` | `https://books.google.com/books?id={volumeId}` | idem | idem | Nenhum | Documentado | developers.google.com/books/docs/v1/using — **NÃO EXECUTADO por cota** | 2026-09-28 |

**Nota de qualidade (matches PT-BR):** no SPIKE-17, busca por título+autor no Open Library acertou o livro certo como 1º/único resultado em 8/8 casos. Duas ressalvas reais observadas: (1) obras internacionais aparecem sob o **título canônico do "work"**, não a tradução — "1984" retornou primeiro "Nineteen Eighty-Four" e "O Pequeno Príncipe" retornou primeiro "Le petit prince" (o registro em `por` existe dentro de `language[]`/edições, mas a UI precisaria buscar a edição em português para exibir o título traduzido); (2) o ISBN usado para o teste de busca-por-ISBN (`8535914846`, digitado de memória como se fosse uma edição de "Dom Casmurro") na verdade pertence a uma edição de **"1984" (Companhia das Letras, 2009)** — o mecanismo funcionou corretamente (retornou dado real e consistente para aquele ISBN), mas evidencia que o ISBN precisa vir de fonte confiável (capa do livro, base already correta), não de suposição.

**Nota sobre acentuação no terminal:** a saída do spike no console Windows mostra caracteres como "Machado de Ass�s"/"Memórias P�stumas" — é mangling de exibição do terminal (cp1252 vs UTF-8), não um problema do dado retornado pela API (o JSON de origem é UTF-8 válido).

---

## 3. Link público de saída ("onde encontrar")

| Platform ID | Formato do link público | Fallback | ID necessário | Como obter o ID |
|---|---|---|---|---|
| P-OL | `https://openlibrary.org/works/{OLID}` (ex.: `.../works/OL24141556W`); edição específica: `https://openlibrary.org/books/{OLID}` | N/A — já é web | `key` (OLID do work) | Campo `key` do resultado de `search.json` |
| P-GB | `https://books.google.com/books?id={volumeId}` (`infoLink`/`canonicalVolumeLink`) | N/A — já é web | `id`/`volumeId` | Campo `items[].id` do resultado de `volumes.list` — **não confirmado por spike** nesta rodada (429) |

Nenhuma das duas documenta um **deep link de app nativo** (scheme `market://`/Universal Link para abrir direto num app de leitura) — não há app de referência oficial para nenhuma das duas APIs (Open Library não tem app mobile oficial amplamente documentado para deep link; Google Books não expõe scheme de deep link documentado para o app "Google Play Livros"). Tratar RF de "onde encontrar" para livros como **SÓ LINK WEB**, não deep link de app, até achar documentação específica (`NÃO VERIFICADO`).

---

## 4. Testes manuais em device

Não aplicável nesta rodada — o escopo pedido é só busca/metadados via API pública (sem share sheet nem app nativo envolvido). Nenhum item desta rodada ficou marcado `VALIDAR EM DEVICE`.

---

## 5. Log de spikes

| Spike ID | Plataforma | Objetivo | Resultado | Conclusão | Script |
|---|---|---|---|---|---|
| SPIKE-17 | P-OL | Buscar 8 títulos (5 BR + 3 internacionais traduzidos) por título+autor via `search.json?language=por`, conferir campos retornados | HTTP 200 em 8/8; `numFound` variou de 1 (matches exatos: Torto Arado, Ainda Estou Aqui, Harry Potter) a 54 (Dom Casmurro, nome comum); em todos os casos o 1º resultado era o livro correto, com `author_name`, `first_publish_year`, `cover_i`, `isbn[]`, `language[]`, `subject[]`, `number_of_pages_median` presentes | Mecanismo de busca confirmado com boa qualidade de match para título+autor em PT-BR; título canônico de obra internacional fica no idioma original (ver nota de qualidade acima) | `docs/phase0/spikes/spike-17-books.sh` |
| SPIKE-17 | P-GB | Repetir as mesmas 8 buscas via `volumes.list` sem `key=`, com `country=BR` | 1ª tentativa (Dom Casmurro) → **HTTP 429**, corpo `"Quota exceeded for quota metric 'Queries' and limit 'Queries per day'... quota_limit_value":"0"` para o consumer anônimo compartilhado; as 7 tentativas seguintes foram puladas (mesmo resultado já confirmado, para não insistir contra uma cota já esgotada) | Acesso sem chave ao Google Books está de fato inoperante hoje (2026-09-28); corroborado por múltiplos relatos de terceiros (issues públicas de outros projetos com o mesmo erro) — não é uma falha pontual desta rede | `docs/phase0/spikes/spike-17-books.sh` |
| SPIKE-17b | P-OL / P-GB | Buscar por ISBN (`8535914846`) nas duas APIs | Open Library `GET /isbn/8535914846.json` → HTTP 200, retornou uma edição real ("1984", Companhia das Letras, 2009 — não "Dom Casmurro" como presumido ao escolher o ISBN de memória); Google Books → pulado (429 já confirmado) | Mecanismo de busca por ISBN do Open Library confirmado (retorna dado real e consistente); reforça que ISBN precisa vir de fonte confiável, não de suposição | `docs/phase0/spikes/spike-17-books.sh` |
| Ad hoc (mesma sessão, não script separado) | P-OL | Verificar se `works/{id}.json` traz sinopse e se `search.json` traz o `key` usável como link público | HTTP 200 em ambas; `description.value` presente (1211 caracteres, em português, para "Torto Arado"); campo `key` = `/works/OL24141556W` confirmado | Sinopse e link público confirmados como disponíveis sem custo/chave, com uma chamada adicional por obra | Não salvo em arquivo separado (comandos registrados neste relatório) |

---

## 6. Pendências

1. **Google Books com chave**: nenhuma `GOOGLE_BOOKS_API_KEY`/`GOOGLE_API_KEY` estava definida no ambiente; o fluxo autenticado (que resolveria o 429 observado) não foi testado. Antes de adotar Google Books como fonte, gerar uma chave gratuita no Google Cloud Console e repetir o SPIKE-17 com `key=`.
2. **Quota real do Google Books com chave**: a documentação oficial não publica um número fixo (só aparece no Console após criar o projeto); relatos de terceiros (GitHub issues) mencionam ~1000 req/dia no tier gratuito, mas isso não é uma fonte oficial e não foi confirmado nesta pesquisa.
3. **Mapeamento assunto → gênero**: nem Open Library (`subject`, texto livre multilíngue) nem Google Books (`categories`, BISAC genérico) entregam uma taxonomia de gênero pronta. É preciso construir um dicionário de normalização (ex.: agrupar variações de "Brazilian fiction"/"Romance brasileiro"/"ficção" num único gênero canônico) antes de expor "gênero" como filtro confiável na UI. Fica como tarefa de implementação, não de viabilidade.
4. **Título traduzido para exibição em PT-BR**: como o Open Library agrupa edições sob um título canônico de "work" (frequentemente no idioma original), exibir o título em português para uma obra internacional exige uma segunda consulta (achar a edição com `language=por` e usar o título dela), não só o campo `title` do `search.json`. Não testado nesta rodada qual edição específica em português cada obra tem associada.
5. **Qualidade/cobertura da sinopse no Open Library**: `description` é campo wiki editável pela comunidade; a amostra única testada ("Torto Arado") veio completa e em português, mas não há garantia de que toda obra tenha sinopse, nem de que esteja em português quando existir. Recomenda-se checar `description` presente/ausente por obra e ter Google Books (ou outra fonte) como fallback quando faltar — o que reforça a pendência 1.
6. **Uso comercial/publicado do Open Library**: a documentação consultada nesta rodada não teve seu status de ToS para app publicado (SC-STORE) auditado — isso é papel do `tos-compliance-auditor`, não deste relatório.
7. **`P-OL`/`P-GB` fora de `platforms.md`**: como registrado no cabeçalho, essas duas plataformas não constam na lista oficial de escopo da Fase 0. Cabe ao `phase0-arbiter`/dono do produto decidir se o tema Livros entra formalmente no escopo e, se sim, adicionar `P-OL`/`P-GB` (com RFs próprios) a `platforms.md`.

---

## 7. Veredito e recomendação

| Plataforma | Veredito | Por quê |
|---|---|---|
| **Open Library (P-OL)** | **VIÁVEL** | Sem chave, sem OAuth, sem custo; busca por título/título+autor/ISBN confirmada com boa qualidade de match para 8/8 títulos BR e internacionais traduzidos (spike real); entrega título, autor, ano, capa, ISBN, idioma, páginas, assuntos e (com uma chamada extra) sinopse; tem link público de "work" direto para "onde encontrar". Limitações são reais mas contornáveis: título canônico às vezes no idioma original, assuntos sem taxonomia fixa, rate limit baixo para lote (1–3 req/s, adequado para consulta sob demanda, não para importação em massa) |
| **Google Books (P-GB)** | **VIÁVEL COM LIMITAÇÃO** | Mecanismo e campos são exatamente os pretendidos (sinopse, categorias, capa, ISBN, idioma) segundo a documentação, mas o spike real desta rodada confirmou que o acesso **sem chave está hoje efetivamente indisponível** (HTTP 429, cota zerada para o consumer anônimo) — contrariando a expectativa de "uso leve sem chave" da doc. Só volta a ser avaliável de fato depois de gerar uma chave gratuita e repetir o teste (pendência 1) |

**Recomendação**: usar **Open Library como fonte primária** de busca e metadados de livros (título, autor, ano, capa, ISBN, idioma, assuntos brutos, sinopse via `works/{id}.json`), por não depender de chave nem de cota incerta e por ter qualidade de match confirmada em PT-BR. Reservar **Google Books como fonte secundária/fallback** (ex.: preencher sinopse quando o Open Library não tiver, ou como segunda fonte para conferência de metadados) **somente depois** de provisionar uma API key gratuita e confirmar por spike que o fluxo autenticado realmente funciona e qual é a cota diária efetiva — não assumir isso hoje. O mapeamento de assuntos/categorias para um conjunto canônico de gêneros precisa ser construído como camada própria em qualquer um dos dois casos, já que nenhuma das APIs entrega uma taxonomia de gênero pronta e estável.
