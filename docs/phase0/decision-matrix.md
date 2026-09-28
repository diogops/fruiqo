# Matriz de decisão — Fase 0 — Fruiqo

Agente: `phase0-arbiter`. Data: **2026-09-27**.

Insumos (lidos integralmente, nenhuma pesquisa nova):
- `docs/phase0/platforms.md` (26 plataformas, 2 cenários)
- `docs/phase0/tos-report.md` (cobre as 21 plataformas originais; **não cobre** P-EXPO, P-SHARE-PLUGIN, P-APPLE-DEV, P-WEBSHARE, P-IOS-SHORTCUTS)
- `docs/phase0/security-threat-model.md`
- `docs/phase0/integration-feasibility.md` (inclui §7 "Veredito da stack mobile")
- Contexto: `docs/fase0-stack-mobile.md` (stack candidata, **não aprovada**)

Este documento não aprova nada. Ele é a base do checkpoint humano.

## Critérios de arbitragem aplicados

1. Decisão = pior dos três eixos, na ordem `NO-GO` > `BLOQUEADO` > `GO COM RESTRIÇÃO` > `GO`.
2. ToS `PROIBIDO` → `NO-GO`. ToS `NÃO VERIFICADO`/`AMBÍGUO` → `BLOQUEADO`.
3. Plataforma ou capacidade **sem análise de ToS** (as 5 plataformas de stack mobile, e capacidades que o `integration-feasibility.md` testou mas o `tos-report.md` não classificou, como os oEmbed de YouTube e Spotify) → ToS `NÃO AVALIADO`, tratado como `NÃO VERIFICADO` → `BLOQUEADO`. Nenhuma lacuna foi preenchida por suposição.
4. Viabilidade `INVIÁVEL` → `NO-GO`. `NÃO VERIFICADO`/`VALIDAR EM DEVICE`/spike `NÃO EXECUTADO` sem doc oficial → `BLOQUEADO`. Mecanismo com doc oficial citada, mas spike não executado por falta de credencial → aceito como viável com a limitação registrada.
5. `PERMITIDO COM CONDIÇÃO` cuja **condição habilitadora** está marcada como `NÃO VERIFICADO` ou pendente de parecer no próprio `tos-report.md` (caso de TOS-REQ-28/29 ↔ PEND-09/PEND-10) é tratado como `BLOQUEADO` até a condição ser comprovada. Condições que são só restrições de design (ex.: não replicar player do Spotify) resultam em `GO COM RESTRIÇÃO`.
6. Segurança: `GAP` sem controle efetivo para ameaça Alta/Crítica → `BLOQUEADO`. Controle definido mas ainda não construído entra como pré-condição na coluna de restrições.
7. Capacidade que depende de outra linha herda o pior status dela (ex.: RF-03 depende de P-LLM e de P-LGPD).

Legenda das colunas ToS e Viabilidade: `P:` = SC-PERSONAL, `S:` = SC-STORE. PCC = PERMITIDO COM CONDIÇÃO. VCL = VIÁVEL COM LIMITAÇÃO.

---

## 1. Matriz de decisão

### 1a. Capacidades pretendidas (conforme `platforms.md`)

| Platform ID | RF | Capacidade | ToS | Viabilidade | Segurança | SC-PERSONAL | SC-STORE | Restrições/condições |
|---|---|---|---|---|---|---|---|---|
| P-IG | RF-01 | Receber URL/post via share sheet do SO | P: PERMITIDO / S: PERMITIDO | VALIDAR EM DEVICE (conteúdo real do share não documentado pela Meta) | Controles definidos: SEC-CTRL-01, 02, 03, 28, 29 (GAP-08, ameaças T-01..T-03 de severidade ≤ Média) | `BLOQUEADO` | `BLOQUEADO` | Teste em device §4.1 do feasibility. Depende de P-EXPO/P-SHARE-PLUGIN (BLOQUEADO). |
| P-IG | RF-03 | Processar o que o share sheet entregar (texto/imagem) via OCR/LLM | Recebimento PERMITIDO; processamento herda P-LLM/P-LGPD | VALIDAR EM DEVICE | SEC-CTRL-02, 03, 05, 07, 08, 09, 30, 38; GAP-02 (T-11 Alta, controle parcial SEC-CTRL-38) | `BLOQUEADO` | `BLOQUEADO` | Herda BLOQUEADO de P-LLM e P-LGPD (PEND-10; PEND-09 para SC-STORE). Não assumir formato do payload antes do teste §4.1. |
| P-IG | RF-03 | Metadados do post via oEmbed oficial da Meta | P: PCC / S: PROIBIDO | VCL (doc oficial; SPIKE-10 não executado; só posts públicos; 1000 req/h; necessidade de App Review não esclarecida) | SEC-CTRL-04, 09, 10, 25 (token Meta só no backend) | `GO COM RESTRIÇÃO` | `NO-GO` | TOS-REQ-08: usar somente o payload do oEmbed. Ver contradição C-03 (oEmbed devolve HTML de embed, não necessariamente a legenda crua). |
| P-IG | RF-03 | Legenda completa/imagem original além do oEmbed | P: NÃO VERIFICADO (tratado como proibido) / S: PROIBIDO | INVIÁVEL (sem mecanismo oficial desde o fim da Basic Display API em 04/12/2024) | N/A | `NO-GO` | `NO-GO` | TOS-REQ-08. Nenhum scraping de HTML/CDN. |
| P-YT | RF-01/03 | Receber vídeo via share sheet do app YouTube | NÃO AVALIADO especificamente (o tos-report classifica o recebimento via SO só em P-IG) | VALIDAR EM DEVICE | SEC-CTRL-01, 02, 03, 28, 29 | `BLOQUEADO` | `BLOQUEADO` | Teste §4.1. Registrar no tos-report se a lógica de P-IG RF-01 vale para YT/TT. |
| P-YT | RF-03 | Metadados via oEmbed sem autenticação | NÃO AVALIADO (tos-report cobre só Data API v3 e proíbe scraping) | VIÁVEL (SPIKE-01, HTTP 200) | SEC-CTRL-04, 10 | `BLOQUEADO` | `BLOQUEADO` | Alternativa já liberável: Data API v3 (linha abaixo). |
| P-YT | RF-03 | Metadados via YouTube Data API v3 (`videos.list`) | P: PCC / S: PCC | VIÁVEL (doc oficial; SPIKE sem chave não executado; cota 10.000 unid./dia) | SEC-CTRL-10, 25, 37 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-05 (cache ≤ 30 dias), TOS-REQ-06 (branding), TOS-REQ-07 (auditoria antes de passar da cota padrão em SC-STORE). Evitar `search.list` (100 unid.). |
| P-YT | RF-15 | Deep link `https://www.youtube.com/watch?v=ID` | P: PCC / S: PCC | VIÁVEL (App Link/Universal Link genérico) | SEC-CTRL-27 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-06. Só ID público na URL (SEC-REQ-12). |
| P-TT | RF-01 | Receber vídeo via share sheet do app TikTok | NÃO AVALIADO especificamente | VALIDAR EM DEVICE (links curtos `vm.tiktok.com` podem exigir resolução adicional) | SEC-CTRL-01, 02, 03, 04, 28, 29 | `BLOQUEADO` | `BLOQUEADO` | Teste §4.1. A resolução de link curto é uma requisição a domínio do TikTok que não foi avaliada em ToS. |
| P-TT | RF-03 | Título/autor/thumbnail via oEmbed público | P: PCC / S: AMBÍGUO | VCL (SPIKE-02, HTTP 200) | SEC-CTRL-04, 09, 10 | `GO COM RESTRIÇÃO` | `BLOQUEADO` | TOS-REQ-09. SC-STORE depende de PEND-02 (uso comercial sem cadastro no TikTok Developer Program). |
| P-TT | RF-03 | Legenda completa/mídia fora do oEmbed | P: PROIBIDO / S: PROIBIDO | INVIÁVEL (Display API exige login do criador) | N/A | `NO-GO` | `NO-GO` | TOS-REQ-09. |
| P-SPOT | RF-05 | Busca via Web API (Client Credentials) | P: PCC / S: PCC | VIÁVEL (doc oficial; SPIKE-07 não executado; rate limit dinâmico) | SEC-CTRL-25 (client secret só no backend), 10, 37 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-10 (atribuição + link de volta), TOS-REQ-12. |
| P-SPOT | RF-15 | Criar/editar playlist, controlar playback (Auth Code + PKCE) | P: PCC / S: PCC | P: VIÁVEL em Development Mode (máx. 5 usuários em allowlist; dono do app com Premium ativo) / S: INVIÁVEL para N usuários (Extended Quota exige organização registrada + 250k MAU) | SEC-CTRL-12 a 18, 26, 27, 40 (rotação de refresh indicada como confirmada para Spotify) | `GO COM RESTRIÇÃO` | `NO-GO` | TOS-REQ-11 (sem player embutido que replique o Spotify). SC-PERSONAL limitado a ≤ 5 usuários. Ver C-04. |
| P-SPOT | RF-15 | Deep link `spotify:track:{id}` / `open.spotify.com` | P: PCC / S: PCC | VIÁVEL (Content Linking documentado) | SEC-CTRL-27 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-10. |
| P-AM | RF-05 | Busca no catálogo (Apple Music API, Developer Token) | P: PCC / S: PCC | VCL (Apple Developer Program pago; SPIKE-09 não executado; rate limit sem número publicado) | SEC-CTRL-25 (chave privada do JWT só no backend) | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-13. Depende da assinatura do Apple Developer Program (P-APPLE-DEV, ToS não avaliado; a rider de MusicKit foi citada no tos-report). |
| P-AM | RF-15 | Playlist/biblioteca do usuário (Music User Token), iOS | PCC (cláusulas de MusicKit citadas em P-AM RF-05; capacidade não classificada em linha própria) | VCL (usuário precisa de assinatura Apple Music) | SEC-CTRL-16, 18; GAP-03 (rotação não confirmada; T-18 Média) | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-13 (cover art só em contexto de playback/playlist; não monetizar acesso ao catálogo). |
| P-AM | RF-15 | Playlist/biblioteca do usuário, Android | Idem | NÃO VERIFICADO (nenhum relatório avalia MusicKit/Music User Token no Android) | Idem | `BLOQUEADO` | `BLOQUEADO` | Precisa de avaliação antes de prometer paridade no Android. |
| P-AM | RF-15 | Deep link iOS (`music.apple.com/...`) | P: PCC / S: PCC | VCL (confiança média, sem doc dedicada a terceiros) | SEC-CTRL-27 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-14 (badge "Listen on Apple Music" sem alteração). |
| P-AM | RF-15 | Deep link Android | P: PCC / S: PCC | VALIDAR EM DEVICE | SEC-CTRL-27 | `BLOQUEADO` | `BLOQUEADO` | Teste §4.2. |
| P-YTM | RF-15 | Deep link `music.youtube.com/watch?v=ID` | P: AMBÍGUO / S: AMBÍGUO | NÃO VERIFICADO / VALIDAR EM DEVICE | SEC-CTRL-27 | `BLOQUEADO` | `BLOQUEADO` | Sem API nem deep link documentados. |
| P-DZ | RF-15 | Busca/leitura pela API pública | P: PCC (não comercial) / S: PROIBIDO | P: VIÁVEL / S: VCL (SPIKE-05; quota não documentada) | SEC-CTRL-10 | `GO COM RESTRIÇÃO` | `NO-GO` | Só uso não comercial. TOS-REQ-15. Ver C-01 (spike executado antes do tos-report). |
| P-DZ | RF-15 | Favoritos/playlist via OAuth | P: PCC / S: PROIBIDO | VCL (processo de aprovação para produção não documentado) | SEC-CTRL-12 a 16, 18; GAP-03 (T-18 Média) | `GO COM RESTRIÇÃO` | `NO-GO` | TOS-REQ-15. Sem rotação de refresh confirmada. |
| P-DZ | RF-15 | Deep link para o app Deezer | P: PCC / S: PROIBIDO | NÃO VERIFICADO / VALIDAR EM DEVICE | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | Teste §4.2. |
| P-NFLX | RF-15 | Deep link para título | P: AMBÍGUO / S: PROIBIDO | NÃO VERIFICADO (`nflx://` só de comunidade; sem fonte pública de ID) | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | TOS-REQ-17. PEND-04. |
| P-NFLX | RF-15 | Watchlist ("Minha Lista") | P: AMBÍGUO (TOS-REQ-17 veda) / S: PROIBIDO | INVIÁVEL (sem API) | N/A | `NO-GO` | `NO-GO` | TOS-REQ-17. |
| P-PRIME | RF-15 | Deep link para título | P: AMBÍGUO / S: PROIBIDO | NÃO VERIFICADO (intent só em fórum; sem fonte de ASIN) | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | TOS-REQ-17. PEND-04. |
| P-DSNY | RF-15 | Deep link para título | P: AMBÍGUO / S: PROIBIDO | NÃO VERIFICADO | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | TOS-REQ-17. Os termos citam explicitamente a vedação de uso "para criar ferramenta de IA". |
| P-MAX | RF-15 | Deep link para título | P: NÃO VERIFICADO / S: PROIBIDO | NÃO VERIFICADO (esquema relatado quebrado após o rebrand) | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | TOS-REQ-17. PEND-12. |
| P-GLOBO | RF-15 | Deep link para título | P: AMBÍGUO / S: PROIBIDO | NÃO VERIFICADO | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | TOS-REQ-17. PEND-11 (fetch direto dos termos falhou). |
| P-ATV | RF-15 | Deep link iOS `tv.apple.com/...` | P: AMBÍGUO / S: PROIBIDO | VCL / VALIDAR EM DEVICE (sem fonte pública do ID `umc.cmc.*`); Android NÃO VERIFICADO | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | TOS-REQ-17. PEND-05. |
| P-NFLX, P-PRIME, P-DSNY, P-MAX, P-GLOBO | RF-15 | Alternativa: abrir a busca por título no app/site | Mesmo status da linha de deep link de cada plataforma (PEND-04) | NÃO VERIFICADO (feasibility §3, nota geral) | SEC-CTRL-27 | `BLOQUEADO` | `NO-GO` | Só reavaliar em SC-PERSONAL após PEND-04 e o teste §4.2. |
| P-TMDB | RF-05 | Busca de filme/série | P: PCC / S: PCC | VIÁVEL (SPIKE-06 não executado por falta de chave) | SEC-CTRL-10, 25, 37 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | TOS-REQ-01, 02, 03; TOS-REQ-04 se houver qualquer monetização. |
| P-TMDB | RF-06 | Watch providers `watch_region=BR` | P: PCC / S: PCC | VIÁVEL (BR confirmado na doc) | SEC-CTRL-10, 25, 37 | `GO COM RESTRIÇÃO` | `GO COM RESTRIÇÃO` | Mesmas de RF-05. Substitui P-JW para RF-06. |
| P-MB | RF-05 | Resolução de música | P: PCC / S: AMBÍGUO | P: VIÁVEL / S: VCL (SPIKE-04; 1 req/s; app mobile tratado como uso comercial, exige contato prévio com a MetaBrainz) | SEC-CTRL-10, 37 (throttle global ≤ 1 req/s) | `GO COM RESTRIÇÃO` | `BLOQUEADO` | TOS-REQ-16 (só campos core CC0). PEND-06. User-Agent identificável. |
| P-JW | RF-06 | Disponibilidade por região via API JustWatch | P: NÃO VERIFICADO / S: PROIBIDO | INVIÁVEL (só com contrato de parceiro) | N/A | `NO-GO` | `NO-GO` | TOS-REQ-18. Usar TMDB watch providers. |
| P-LLM | RF-03/04 | Extração estruturada via Anthropic Messages API | P: PCC / S: PCC — condição habilitadora TOS-REQ-29 depende de PEND-10 (NÃO VERIFICADO); SC-STORE também TOS-REQ-28 ↔ PEND-09 | VIÁVEL (SPIKE-08 não executado; região não confirmada) | SEC-CTRL-07, 08, 09, 10, 23, 25, 38; GAP-02 e GAP-07 (T-11 Alta, controle parcial) | `BLOQUEADO` | `BLOQUEADO` | Desbloqueio: PEND-10 (ambos) + PEND-09 (SC-STORE). Depois disso: TOS-REQ-19, 20, 30; SEC-REQ-04, 05, 06, 23. Dados sintéticos/sem PII não dependem disso (Decisão 4). |
| P-MLKIT | RF-03 | OCR on-device Android (ML Kit Text Recognition v2) | P: PERMITIDO / S: PERMITIDO | VIÁVEL | Sem ameaça específica; SEC-CTRL-29 | `GO` | `GO` | TOS-REQ-21 (manter on-device). Integração com Expo não avaliada (ver PND-22). |
| P-MLKIT | RF-03 | OCR on-device iOS (Apple Vision) | P: PERMITIDO / S: PERMITIDO | VIÁVEL | Idem | `GO` | `GO` | TOS-REQ-21. Idem. |
| P-APPSTORE | SC-STORE | Publicação na App Store | S: PCC (4.2.2, 5.2.2, 5.2.3, 4.8) | Processo de review (não é API) | SEC-REQ-16, 21 aplicáveis a SC-STORE | N/A | `GO COM RESTRIÇÃO` | TOS-REQ-22, 23, 24. Toda integração no build de loja precisa de evidência de autorização (5.2.2), o que exclui todas as linhas NO-GO/BLOQUEADO em SC-STORE. Risco de 4.2.2 cresce se o RF-15 virar lista de links. |
| P-PLAY | SC-STORE | Publicação no Google Play | S: PCC | Processo de review (não é API) | SEC-REQ-10, 24 | N/A | `GO COM RESTRIÇÃO` | TOS-REQ-25, 26, 27. |
| P-LGPD | RNF-03 | Tratamento de dados pessoais do conteúdo compartilhado (inclui terceiros incidentais) | P: PCC / S: PCC — TOS-REQ-28 "antes de SC-STORE" pendente de parecer (PEND-09) | N/A | SEC-CTRL-22, 23, 24, 38; GAP-02, GAP-06, GAP-07 | `GO COM RESTRIÇÃO` | `BLOQUEADO` | SC-STORE: PEND-09 + GAP-06 (SEC-CTRL-39 vira obrigatório antes de operar SC-STORE com suporte). |
| P-LGPD | RNF-03 | Transferência internacional (Anthropic e demais fornecedores estrangeiros) | P: PCC / S: PCC — mecanismo (TOS-REQ-29) NÃO VERIFICADO (PEND-10) | N/A | SEC-CTRL-38 | `BLOQUEADO` | `BLOQUEADO` | TOS-REQ-29 não tem qualificador de cenário (C-12). |
| P-EXPO | RF-01 | Intent `ACTION_SEND` Android via `expo prebuild` | NÃO AVALIADO | VIÁVEL (SPIKE-12: manifest com `SEND` + `text/*`, `image/*`) | SEC-CTRL-02, 03, 29 | `BLOQUEADO` | `BLOQUEADO` | Bloqueio apenas por ToS não avaliado. `SEND_MULTIPLE` não exercitado no spike. |
| P-EXPO | RF-01 | Share Extension iOS via `expo prebuild` | NÃO AVALIADO | NÃO VERIFICADO (SPIKE-12 falhou no host Windows) | SEC-CTRL-01, 28, 29; GAP-08 | `BLOQUEADO` | `BLOQUEADO` | Repetir em macOS/Linux ou EAS Build sem publicar (pendência 11 do feasibility). |
| P-EXPO | RF-15 | Armazenamento seguro de tokens (`expo-secure-store`) | NÃO AVALIADO | VIÁVEL (doc oficial) | SEC-CTRL-16 | `BLOQUEADO` | `BLOQUEADO` | Preferência do threat model: tokens de streaming só no backend (SEC-REQ-08). |
| P-EXPO | RNF | EAS Build | NÃO AVALIADO | NÃO VERIFICADO (não executado por regra da rodada) | SEC-CTRL-25 (checagem de artefato) | `BLOQUEADO` | `BLOQUEADO` | Build local via prebuild é alternativa sem ToS de serviço de nuvem. |
| P-SHARE-PLUGIN | RF-01 | `expo-share-intent` v8.0.1: URL/texto | NÃO AVALIADO (licença MIT citada no feasibility não é análise de ToS) | VCL (Android confirmado; iOS não verificado; mantenedor único, 39 issues; conflito com Expo Router com workaround) | SEC-CTRL-01, 28, 29 | `BLOQUEADO` | `BLOQUEADO` | Pendências 11, 12, 13 do feasibility. |
| P-SHARE-PLUGIN | RF-01 | Imagem única/múltiplas | NÃO AVALIADO | VCL (só README; `image/*` confirmado no manifest) | SEC-CTRL-02, 03, 29, 30 | `BLOQUEADO` | `BLOQUEADO` | — |
| P-SHARE-PLUGIN | RF-01 | PDF/arquivo | NÃO AVALIADO | NÃO VERIFICADO (declarado no README, não exercitado no spike) | SEC-CTRL-02, 05, 30 | `BLOQUEADO` | `BLOQUEADO` | Incluir `application/pdf` no próximo spike. |
| P-APPLE-DEV | SC-PERSONAL | App Groups + TestFlight interno | NÃO AVALIADO (P-APPSTORE cobre só as Review Guidelines; o Developer Program License Agreement não foi analisado para App Groups/TestFlight) | VIÁVEL (US$ 99/ano obrigatório mesmo para uso pessoal) | SEC-CTRL-28 | `BLOQUEADO` | N/A | Custo de SC-PERSONAL deixa de ser zero (C-10). |
| P-APPLE-DEV | SC-STORE | TestFlight externo / distribuição | NÃO AVALIADO | VIÁVEL | — | N/A | `BLOQUEADO` | Sobreposição com P-APPSTORE (C-09). |
| P-WEBSHARE | RF-01 | Web Share Target no Safari/iOS | NÃO AVALIADO | INVIÁVEL (WebKit #194593 aberto desde 2019) | N/A | `NO-GO` | `NO-GO` | Confirma a premissa de descartar PWA como app principal. |
| P-WEBSHARE | RF-01 | Web Share Target no Chrome/Android | NÃO AVALIADO | VCL (exige PWA instalada; `url` chega vazio, vem em `text`) | SEC-CTRL-02, 03 | `BLOQUEADO` | `BLOQUEADO` | Só relevante se a contingência PWA for escolhida. |
| P-IOS-SHORTCUTS | RF-01 | Atalho no share sheet com POST autenticado | NÃO AVALIADO | P: VCL / VALIDAR EM DEVICE; S: INVIÁVEL (sem distribuição automática) | GAP-05: T-28 **Crítica** depende de SEC-CTRL-31, que ainda não existe; também SEC-CTRL-21, 32, 33 | `BLOQUEADO` | `NO-GO` | Pré-condição dura: SEC-CTRL-31 (token pessoal escopado a `share:create`, revogável) construído e verificado antes de habilitar. Teste §4.4. |

### 1b. Usos vedados e opções de arquitetura (fora das capacidades pretendidas, registrados como restrição)

| Platform ID | RF | Capacidade | ToS | Viabilidade | Segurança | SC-PERSONAL | SC-STORE | Restrições/condições |
|---|---|---|---|---|---|---|---|---|
| P-SPOT | RNF | Usar conteúdo do Spotify para treinar/alimentar modelo de IA | PROIBIDO | N/A | N/A | `NO-GO` | `NO-GO` | TOS-REQ-12. Metadado do Spotify não vai para o LLM. |
| P-TMDB | RNF | Treino/fine-tuning com dados TMDB | PROIBIDO | N/A | N/A | `NO-GO` | `NO-GO` | TOS-REQ-03. |
| P-TMDB | RNF | Metadado TMDB como contexto do LLM em inferência (RAG/grounding) | AMBÍGUO | N/A | N/A | `BLOQUEADO` | `BLOQUEADO` | PEND-03. Pipeline deve ser LLM → resolução (TMDB), nunca TMDB → LLM (ARB-REQ-02). |
| P-YTM | RF-05 | Busca no YouTube Music | Não há API oficial | INVIÁVEL (só engenharia reversa, `ytmusicapi`) | N/A | `NO-GO` | `NO-GO` | Não usar wrappers não oficiais. |
| P-SPOT | RF-15 | oEmbed do Spotify | NÃO AVALIADO | VIÁVEL (SPIKE-03) | N/A | `BLOQUEADO` | `BLOQUEADO` | Não é necessário: a Web API cobre a necessidade. |
| P-APPSTORE | SC-STORE | Baixar/gravar mídia de terceiros | PROIBIDO sem autorização (5.2.3) | N/A | N/A | N/A | `NO-GO` | TOS-REQ-24. Evitado pelo próprio design. |
| — | RF-03 | Fetch genérico de URL arbitrária compartilhada (F-02 do threat model) apontando para domínios de IG/TT/YT | PROIBIDO (scraping: TOS-REQ-08, 09, política do YouTube) | N/A | SEC-CTRL-04, 06 (GAP-01) | `NO-GO` | `NO-GO` | Ver C-05. Para outros domínios: ToS NÃO AVALIADO → `BLOQUEADO`. |
| — | RF-01 | Expo + alternativa (`react-native-receive-sharing-intent` / `expo-share-extension`) | NÃO AVALIADO | NÃO VERIFICADO (sem spike) | N/A | `BLOQUEADO` | `BLOQUEADO` | Plano B teórico (feasibility §7). |

---

## 2. Impacto no produto

| RF | Plataformas afetadas | Degradação | Alternativa proposta |
|---|---|---|---|
| RF-01 (receber via share) | P-IG, P-YT, P-TT (VALIDAR EM DEVICE); P-EXPO/P-SHARE-PLUGIN (ToS não avaliado; iOS não verificado); P-APPLE-DEV | **O requisito central está BLOQUEADO nos dois cenários.** Não há hoje evidência de que o app recebe algo do Instagram no iOS, nem do que o Instagram entrega. | Três desbloqueios, todos baratos: (1) repetir SPIKE-12 em macOS/EAS, incluindo PDF; (2) testes §4.1 em device; (3) rodar o tos-compliance-auditor nas 5 plataformas de stack. Contingência só para SC-PERSONAL: Atalho iOS (P-IOS-SHORTCUTS), condicionado a SEC-CTRL-31. PWA no iOS é NO-GO. |
| RF-03 (extração de texto/imagem) | P-IG (além do oEmbed = NO-GO; oEmbed em SC-STORE = NO-GO); P-TT (fora do oEmbed = NO-GO; oEmbed em SC-STORE = BLOQUEADO); P-YT (oEmbed sem ToS); P-LLM (BLOQUEADO) | Sem scraping: o Fruiqo só processa (a) o que o share sheet entregar e (b) payloads oficiais (oEmbed IG/TT em SC-PERSONAL, YouTube Data API). Em SC-STORE, o Instagram fica restrito ao conteúdo do share sheet. O LLM está bloqueado até PEND-10. | OCR on-device (ML Kit/Vision, GO) como primeira etapa, reduzindo o envio de imagem crua ao LLM (endereça GAP-02). YouTube via Data API v3. Se o share do Instagram entregar só a URL, RF-03 para Instagram em SC-STORE fica sem conteúdo extraível: nesse caso, RF-03 depende de o usuário compartilhar print/imagem (a validar). |
| RF-04 (detecção via LLM) | P-LLM | BLOQUEADO até PEND-10 (ambos) e PEND-09 (SC-STORE). | Desenvolver com dados sintéticos/sem PII enquanto PEND-10 é verificado (Decisão 4). |
| RF-05 (busca/resolução) | P-MB (SC-STORE BLOQUEADO); P-YTM (sem busca) | Em SC-STORE, a resolução de música fica sem MusicBrainz até PEND-06 e o contato com a MetaBrainz. | Música: Spotify Search (Client Credentials, GO COM RESTRIÇÃO nos dois cenários) + Apple Music catálogo. Filmes/séries: TMDB. MusicBrainz só em SC-PERSONAL. |
| RF-06 (disponibilidade por região) | P-JW (NO-GO) | Sem granularidade de preço de aluguel/compra nem deep link por provedor que só a JustWatch paga teria. | TMDB `watch/providers` com `watch_region=BR` (GO COM RESTRIÇÃO), com atribuição TMDB. |
| RF-15 (streaming: vídeo) | P-NFLX, P-PRIME, P-DSNY, P-MAX, P-GLOBO, P-ATV | **Em SC-STORE: NO-GO para todos.** Em SC-PERSONAL: BLOQUEADO (ToS ambíguo + deep link não documentado). Watchlist Netflix: NO-GO. RF-15 de vídeo vira "mostrar onde está disponível" (via TMDB), sem abrir o título. | Exibir provedores via TMDB sem link de ação. Em SC-PERSONAL, reavaliar após PEND-04 (parecer + contato) e teste §4.2. |
| RF-15 (streaming: música) | P-SPOT (playlist/playback em SC-STORE = NO-GO); P-DZ (SC-STORE = NO-GO; deep link BLOQUEADO); P-YTM (BLOQUEADO); P-AM Android (BLOQUEADO) | Em SC-STORE, "adicionar à playlist/tocar" no Spotify não escala além de 5 usuários → só busca + deep link. Deezer sai de SC-STORE. YouTube Music sem suporte. Apple Music com escrita e deep link apenas no iOS. | Spotify: deep link + busca para todos; playlist só para usuários em allowlist (≤ 5, SC-PERSONAL). Apple Music no iOS com badge oficial. Deezer só em SC-PERSONAL, se desejado. |
| RNF-03 (LGPD) | P-LGPD | Transferência internacional BLOQUEADA nos dois cenários; base legal para SC-STORE pendente de parecer. | Verificar DPA/cláusulas da Anthropic (PEND-10); parecer jurídico (PEND-09) antes de SC-STORE. |
| SC-STORE (geral) | P-APPSTORE, P-PLAY, P-APPLE-DEV | Guideline 5.2.2 exige autorização comprovável de cada serviço, então o build de loja só pode conter linhas GO/GO COM RESTRIÇÃO em SC-STORE. Com o RF-15 reduzido, cresce o risco de 4.2.2 ("coleção de links"). | Build de loja com feature flags por cenário (ARB-REQ-05); diferencial próprio (extração + organização) em primeiro plano (TOS-REQ-22). |

---

## 3. Escopo de integrações recomendado para o MVP

Recomendação: **MVP em SC-PERSONAL**. SC-STORE tem bloqueios estruturais que não se resolvem por engenharia (PEND-09 jurídico, Extended Quota do Spotify, NO-GO nos vídeos, 4.2.2).

| Integração | Entra no MVP? | Status atual (SC-PERSONAL) | Justificativa (relatório) |
|---|---|---|---|
| Expo + `expo-share-intent` (P-EXPO, P-SHARE-PLUGIN) | Sim, **condicionado** | BLOQUEADO | Melhor opção encontrada (feasibility §7), Android confirmado por spike. Falta ToS, iOS em macOS e PDF. |
| Apple Developer Program (P-APPLE-DEV) | Sim, **condicionado** | BLOQUEADO | Obrigatório para App Groups mesmo em uso pessoal (feasibility, pendência 14). Falta ToS. |
| OCR on-device ML Kit / Apple Vision (P-MLKIT) | Sim | GO | PERMITIDO + VIÁVEL, sem transferência de dados; reduz GAP-02. |
| Anthropic Messages API (P-LLM) | Sim, **condicionado** | BLOQUEADO | Núcleo de RF-03/04. Desbloqueia com PEND-10. Controles SEC-CTRL-07/08/09 definidos. |
| YouTube Data API v3 + deep link (P-YT) | Sim | GO COM RESTRIÇÃO | Único caminho de metadados do YouTube com ToS classificado (TOS-REQ-05/06). |
| Instagram oEmbed (P-IG) | Opcional | GO COM RESTRIÇÃO | Só SC-PERSONAL (SC-STORE = NO-GO). Valor depende do resultado do teste §4.1 e da C-03. |
| TikTok oEmbed (P-TT) | Opcional | GO COM RESTRIÇÃO | Barato (spike OK); SC-STORE depende de PEND-02. |
| TMDB busca + watch providers BR (P-TMDB) | Sim | GO COM RESTRIÇÃO | Cobre RF-05 (vídeo) e RF-06, substituindo a JustWatch. Atribuição e TTL de 6 meses. |
| Spotify: busca + deep link (P-SPOT) | Sim | GO COM RESTRIÇÃO | Único caminho de música que se mantém em SC-STORE. |
| Spotify: playlist/playback (P-SPOT) | Sim, ≤ 5 usuários | GO COM RESTRIÇÃO | Development Mode; exige que o dono do app tenha Premium. |
| Apple Music: catálogo + deep link iOS (P-AM) | Opcional | GO COM RESTRIÇÃO | Reaproveita a conta paga da Apple; Android bloqueado. |
| MusicBrainz (P-MB) | Opcional | GO COM RESTRIÇÃO | Só campos core; 1 req/s. SC-STORE bloqueado. |
| Deezer (P-DZ) | Não recomendado | GO COM RESTRIÇÃO (leitura) | NO-GO em SC-STORE; não se justifica no MVP. |
| Netflix, Prime, Disney+, Max, Globoplay, Apple TV+ | Não | BLOQUEADO | ToS ambíguo/não verificado + deep link não documentado; NO-GO em SC-STORE. |
| YouTube Music, JustWatch, Web Share Target | Não | BLOQUEADO / NO-GO | Sem API oficial / só contrato / iOS inviável. |
| Atalho iOS (P-IOS-SHORTCUTS) | Só como contingência | BLOQUEADO | Só se a stack Expo falhar no iOS; exige SEC-CTRL-31 construído antes. |

---

## 4. Requisitos herdados para a Fase 1

### 4.1 Obrigações de ToS/regulatórias (`tos-report.md`)

| ID | Requisito | Origem | Escopo |
|---|---|---|---|
| TOS-REQ-01 | Atribuição TMDB (texto + logo) em About/Créditos | P-TMDB | Ambos |
| TOS-REQ-02 | TTL máximo de 6 meses para qualquer dado TMDB | P-TMDB | Ambos |
| TOS-REQ-03 | Não treinar/fine-tunar com TMDB; esclarecer RAG antes de usar (PEND-03) | P-TMDB | Ambos |
| TOS-REQ-04 | Acordo comercial escrito com a TMDB se houver monetização | P-TMDB | SC-STORE |
| TOS-REQ-05 | TTL máximo de 30 dias para dados da YouTube Data API | P-YT | Ambos |
| TOS-REQ-06 | YouTube Brand Features onde houver conteúdo do YouTube | P-YT | Ambos |
| TOS-REQ-07 | API Compliance Audit antes de passar de 10.000 unid./dia | P-YT | SC-STORE |
| TOS-REQ-08 | Nenhum scraping de HTML/CDN do Instagram além do oEmbed | P-IG | Ambos |
| TOS-REQ-09 | Nenhum download de mídia do TikTok fora do oEmbed | P-TT | Ambos |
| TOS-REQ-10 | Atribuição Spotify + link de volta em todo metadado/artwork | P-SPOT | Ambos |
| TOS-REQ-11 | Sem player embutido que replique o Spotify | P-SPOT | Ambos |
| TOS-REQ-12 | Nunca usar conteúdo Spotify como dado de treino | P-SPOT | Ambos |
| TOS-REQ-13 | Não monetizar acesso ao catálogo Apple Music; cover art só em playback/playlist | P-AM | Ambos |
| TOS-REQ-14 | Badge "Listen on Apple Music" sem alteração | P-AM | Ambos |
| TOS-REQ-15 | Aprovação comercial escrita da Deezer antes de SC-STORE | P-DZ | SC-STORE |
| TOS-REQ-16 | MusicBrainz restrito a campos core (CC0) em distribuição comercial | P-MB | SC-STORE (recomendado em ambos) |
| TOS-REQ-17 | Nenhuma integração com Netflix/Prime/Disney+/Max/Globoplay/Apple TV+ além de URL pública, até confirmação oficial | Vídeo | Ambos |
| TOS-REQ-18 | Nenhum consumo da API JustWatch sem contrato | P-JW | Ambos |
| TOS-REQ-19 | Usar só a API comercial da Anthropic | P-LLM | Ambos |
| TOS-REQ-20 | Validação por schema estrito; conteúdo compartilhado como dado não confiável | P-LLM | Ambos |
| TOS-REQ-21 | OCR permanece on-device | P-MLKIT | Ambos |
| TOS-REQ-22 | Funcionalidade própria substantiva além de agregação de links (4.2.2) | P-APPSTORE | SC-STORE |
| TOS-REQ-23 | Dossiê de evidência de autorização por serviço integrado (5.2.2) | P-APPSTORE | SC-STORE |
| TOS-REQ-24 | Sem download/gravação de áudio/vídeo de terceiros | P-APPSTORE | Ambos |
| TOS-REQ-25 | Conformidade e responsabilidade documentada de cada SDK no Android | P-PLAY | SC-STORE |
| TOS-REQ-26 | Brand guidelines exatas de cada marca de terceiro | P-PLAY | Ambos |
| TOS-REQ-27 | Rotulagem de conteúdo gerado por IA + canal de denúncia | P-PLAY | SC-STORE |
| TOS-REQ-28 | Base legal LGPD definida (parecer) + política de privacidade | P-LGPD | SC-STORE (pré-condição) |
| TOS-REQ-29 | Mecanismo formal de transferência internacional antes de enviar dados pessoais ao exterior | P-LGPD | Ambos (pré-condição; PEND-10) |
| TOS-REQ-30 | Tela de consentimento/transparência sobre envio ao provedor de IA e retenção | P-LGPD, P-LLM | Ambos |

### 4.2 Requisitos de segurança (`security-threat-model.md`)

| ID | Requisito (resumo) | Escopo |
|---|---|---|
| SEC-REQ-01 | Fetch SSRF-safe (IP privado/metadata, revalidação por redirect, scheme, timeout, cap de tamanho) | Ambos |
| SEC-REQ-02 | Limites de tamanho/tipo por etapa; MIME por magic bytes; default-deny | Ambos |
| SEC-REQ-03 | Parsing isolado com limites de CPU/memória/tempo e proteção contra decompression bomb | Ambos |
| SEC-REQ-04 | Conteúdo como dado delimitado no prompt; LLM sem `tools` | Ambos |
| SEC-REQ-05 | Saída do LLM validada por JSON Schema estrito, fail-closed | Ambos |
| SEC-REQ-06 | Quota por usuário (LLM/OCR) + throttling global por rota | Ambos |
| SEC-REQ-07 | OAuth com Auth Code + PKCE S256, `state` de uso único, App/Universal Links, escopos mínimos | Ambos |
| SEC-REQ-08 | Tokens de streaming só no backend, cifrados; no device só via Keychain/Keystore | Ambos |
| SEC-REQ-09 | Rotação de refresh token onde suportado; reuso revoga sessão | Ambos |
| SEC-REQ-10 | Nenhuma chave de terceiro no bundle; secret scanning no CI + checagem de artefato | Ambos |
| SEC-REQ-11 | Deep link de entrada com domínio verificado, schema estrito e correlação com `state` | Ambos |
| SEC-REQ-12 | Deep link de saída só com ID público | Ambos |
| SEC-REQ-13 | Conteúdo bruto/log cifrados; URL pré-assinada curta; bucket nunca público | Ambos |
| SEC-REQ-14 | Logs sem token/segredo/PII; sanitização automática | Ambos |
| SEC-REQ-15 | Retenção com TTL, purga automática, exclusão de conta em cascata | Ambos |
| SEC-REQ-16 | Multi-tenancy: `user_id` da sessão + RLS | SC-STORE (recomendado desde o início) |
| SEC-REQ-17 | Nenhum endpoint de ingestão sem autenticação, mesmo em SC-PERSONAL | Ambos |
| SEC-REQ-18 | Redis não exposto; schema de job validado no worker | Ambos |
| SEC-REQ-19 | Token pessoal dedicado e escopado para o Atalho iOS | SC-PERSONAL (pré-condição de P-IOS-SHORTCUTS) |
| SEC-REQ-20 | Aviso explícito ao gerar o token do Atalho (iCloud/compartilhamento) | SC-PERSONAL (idem) |
| SEC-REQ-21 | Autenticação da conta com lockout/rate limit e hash seguro (ou passwordless equivalente) | SC-STORE (obrigatório) |
| SEC-REQ-22 | Sessões de device listáveis e revogáveis | Ambos |
| SEC-REQ-23 | Disclosure de IA antes do primeiro uso; mecanismo de transferência antes de SC-STORE | Ambos |
| SEC-REQ-24 | Scanning de dependências/SDKs com bloqueio em CVE crítica | Ambos |

Notas herdadas do threat model:
- SEC-CTRL-11 (idempotência) e SEC-CTRL-39 (trilha de auditoria admin) estão marcados como não-MVP. Pela GAP-06, SEC-CTRL-39 passa a ser **obrigatório antes de SC-STORE**.
- Certificate pinning (SEC-CTRL-34) foi adiado para depois do MVP, por decisão documentada.
- GAP-01 (isolamento de rede do worker no hosting) segue aberto até a hospedagem ser definida. A hospedagem não está em `platforms.md` e não foi arbitrada aqui (ver PND-21).

### 4.3 Restrições derivadas da arbitragem (sem pesquisa nova; resolvem contradições entre relatórios)

| ID | Restrição | Motivo |
|---|---|---|
| ARB-REQ-01 | O fetch de URL (F-02) só pode chamar endpoints oficiais liberados nesta matriz (oEmbed IG/TT em SC-PERSONAL, YouTube Data API). Proibido buscar HTML de páginas de Instagram, TikTok ou YouTube. Fetch de outros domínios fica desabilitado até análise de ToS. | C-05 |
| ARB-REQ-02 | Ordem do pipeline: conteúdo → LLM → resolução (TMDB/MB/Spotify). Nenhum metadado de TMDB/Spotify é enviado ao LLM enquanto PEND-03 estiver aberto. | TOS-REQ-03, 12 |
| ARB-REQ-03 | Nenhum novo spike ou chamada de rede a uma plataforma sem status ToS ≥ PCC no cenário correspondente. | C-01, C-02 |
| ARB-REQ-04 | Nenhuma decisão de design de RF-01/RF-03 pode assumir o formato do payload do share sheet antes do registro do teste §4.1 em `docs/phase0/device-tests-log.md`. | Feasibility, pendência 7 |
| ARB-REQ-05 | Integrações ligadas por feature flag por cenário. O build SC-STORE exclui toda linha NO-GO/BLOQUEADO em SC-STORE (5.2.2). Escopos de usuário do Spotify ficam limitados à allowlist de Development Mode. | TOS-REQ-23, C-04 |

---

## 5. Contradições e pendências

### 5.1 Contradições entre relatórios

| ID | Contradição | Arbitragem | Dono sugerido |
|---|---|---|---|
| C-01 | **Incidente:** SPIKE-05 (`GET api.deezer.com/search?q=eminem`, sem auth) foi executado contra P-DZ antes de o tos-report existir. O tos-report marca P-DZ como PROIBIDO em SC-STORE (uso comercial exige aprovação prévia) e PCC em SC-PERSONAL (só não comercial). A chamada foi pontual, de leitura, em contexto de pesquisa, compatível com a leitura "não comercial" de SC-PERSONAL, mas foi feita sem liberação de ToS. | Registrado como desvio de processo. O resultado do spike não deve ser reutilizado como base para SC-STORE. Nenhuma nova chamada à Deezer (ARB-REQ-03). Confirmar que nenhum dado de resposta ficou versionado além do script. | Você |
| C-02 | Os demais spikes também rodaram antes do tos-report: SPIKE-01 (oEmbed do YouTube, sem classificação de ToS), SPIKE-02 (oEmbed do TikTok, AMBÍGUO em SC-STORE), SPIKE-03 (oEmbed do Spotify, sem classificação), SPIKE-04 (MusicBrainz, PCC). | Nenhum caiu em PROIBIDO. Os oEmbed de YT e Spotify seguem BLOQUEADOS por falta de classificação. | Você (reexecutar o tos-compliance-auditor) |
| C-03 | P-IG oEmbed: o feasibility diz que ele fornece "título/legenda/thumbnail"; o tos-report diz que devolve HTML de embed, não a legenda crua. Além disso, o tos-report dá PROIBIDO em SC-STORE para RF-03 como um todo, enquanto a observação sugere que o payload do oEmbed seria aceitável. | Aplicado o status literal: SC-STORE = NO-GO. Utilidade real do oEmbed para RF-03 em aberto. | Contato com plataforma (Meta) + reexecução do auditor |
| C-04 | Spotify SC-STORE: a tabela-resumo do feasibility diz "VIÁVEL COM LIMITAÇÃO", mas o texto diz que Extended Quota é "inviável para um app novo em SC-STORE além de busca/deep link". | Playlist/playback em SC-STORE = INVIÁVEL → NO-GO. Busca e deep link seguem GO COM RESTRIÇÃO. | Você |
| C-05 | O DFD do threat model tem o worker fazendo "fetch de URL" contra IG (F-02), com controle só de SSRF. Buscar a página do post do Instagram/TikTok/YouTube é scraping vedado (TOS-REQ-08, 09, política do YouTube). | Fetch genérico dessas plataformas = NO-GO (ARB-REQ-01). SEC-CTRL-04 continua obrigatório para os fetches permitidos. | Você (spec da Fase 1) |
| C-06 | P-TMDB comercial: o feasibility marca NÃO VERIFICADO; o tos-report resolve (não comercial OK; monetizado exige acordo escrito). | Prevalece o tos-report no eixo ToS. O status em SC-STORE depende da decisão de monetização (Decisão 2). | Você |
| C-07 | P-MB: o feasibility diz que app mobile é uso comercial e exige contato prévio (política de acesso à API); o tos-report trata da licença dos dados (core CC0 vs. suplementares NC). São dois aspectos distintos e ambos valem. | SC-STORE = BLOQUEADO até contato com a MetaBrainz + PEND-06. | Contato com plataforma |
| C-08 | TOS-REQ-17 admite "abrir URL pública padrão (quando existir)" para as plataformas de vídeo, mas o tos-report dá PROIBIDO em SC-STORE para o mesmo RF-15. | Aplicado o status literal: NO-GO em SC-STORE. A leitura permissiva depende de PEND-04. | Parecer jurídico |
| C-09 | As 5 plataformas de stack mobile não têm análise de ToS. P-APPLE-DEV e P-APPSTORE se sobrepõem só em parte: o tos-report cobre as Review Guidelines (SC-STORE) e cita o Developer Program License Agreement apenas para MusicKit e o SDK Agreement para Vision. TestFlight interno, App Groups e Share Extension (SC-PERSONAL) ficaram sem análise, e P-APPSTORE está marcado N/A em SC-PERSONAL. | Fail-closed: as 5 ficam BLOQUEADAS nos dois cenários. | Você (reexecutar o tos-compliance-auditor para as 5) |
| C-10 | `platforms.md` define SC-PERSONAL como "sideload / TestFlight interno"; o feasibility mostra que App Groups exige o programa pago (US$ 99/ano) mesmo para sideload via Xcode. | Custo obrigatório registrado. Não bloqueia, mas muda a premissa de SC-PERSONAL. | Você |
| C-11 | P-MAX: a coluna do tos-report diz NÃO VERIFICADO em SC-PERSONAL, e a observação diz "tratado como proibido em ambos os cenários". | Aplicada a regra: NÃO VERIFICADO → BLOQUEADO. Sem efeito prático (não é GO em nenhum caso). | Reexecução do auditor (PEND-12) |
| C-12 | TOS-REQ-29 exige mecanismo de transferência "antes de enviar dados pessoais" sem qualificar o cenário, mas o tos-report classifica SC-PERSONAL como PCC. PEND-10 (mecanismo com a Anthropic) está NÃO VERIFICADO. | Condição habilitadora não comprovada → P-LLM e a transferência ficam BLOQUEADOS também em SC-PERSONAL (critério 5). | Contato com plataforma (Anthropic) + parecer jurídico |
| C-13 | O threat model afirma que a rotação de refresh token está "confirmada para Spotify", mas o feasibility não traz fonte para isso. | Mantido como controle (SEC-CTRL-17), com verificação obrigatória por teste na Fase 1. | Você (Fase 1) |
| C-14 | O threat model (GAP-01) pede ao arbiter que reavalie a hospedagem, mas a hospedagem (Railway) não consta em `platforms.md` e não tem análise em nenhum relatório. | Fora do escopo desta arbitragem. GAP-01 segue aberto; SEC-CTRL-04 é a única linha de defesa até a decisão. | Você |

### 5.2 Pendências

| ID | Pendência | Bloqueia | Dono sugerido |
|---|---|---|---|
| PND-01 | Teste §4.1: payload do share sheet de IG/YT/TT em iOS e Android (texto, imagem, vídeo, Reel/Short) | RF-01, RF-03 | Teste em device |
| PND-02 | Repetir SPIKE-12 em macOS/Linux ou EAS Build sem publicar; incluir `application/pdf` e `SEND_MULTIPLE` | RF-01 iOS (P-EXPO, P-SHARE-PLUGIN) | Você (host macOS) + teste em device |
| PND-03 | Análise de ToS de P-EXPO, P-SHARE-PLUGIN, P-APPLE-DEV, P-WEBSHARE, P-IOS-SHORTCUTS, e dos oEmbed de YouTube/Spotify e do recebimento via share de YT/TT | Toda a stack mobile | Você (reexecutar o tos-compliance-auditor) |
| PND-04 | PEND-10: DPA/cláusulas padrão ANPD com a Anthropic | P-LLM, RF-03/04 (ambos) | Contato com plataforma (Anthropic) |
| PND-05 | PEND-09: base legal para dado de terceiro incidental | SC-STORE | Parecer jurídico |
| PND-06 | PEND-01 + feasibility pendência 9: oEmbed da Meta (conteúdo útil do payload, necessidade de App Review) | P-IG RF-03 | Contato com plataforma (Meta) |
| PND-07 | PEND-02: uso comercial do oEmbed do TikTok | P-TT SC-STORE | Contato com plataforma / parecer jurídico |
| PND-08 | PEND-03: TMDB como contexto de inferência do LLM | Opção de RAG | Contato com plataforma (TMDB) |
| PND-09 | PEND-04 e PEND-05: deep link/abertura de URL para plataformas de vídeo; cláusula "deep-link" dos termos da Apple | RF-15 vídeo | Parecer jurídico + contato com plataformas |
| PND-10 | PEND-06 + contato com a MetaBrainz para app comercial | P-MB SC-STORE | Você (mapear campos) + contato com plataforma |
| PND-11 | PEND-07: aprovação comercial da Deezer | P-DZ SC-STORE | Contato com plataforma (só se Deezer for mantida) |
| PND-12 | PEND-08: contrato JustWatch | P-JW | Contato com plataforma. Recomendação: descartar. |
| PND-13 | PEND-11 e PEND-12: termos do Globoplay (fetch falhou) e do Max (não localizados) | P-GLOBO, P-MAX | Você (reexecutar o auditor) |
| PND-14 | Teste §4.2: deep links de YTM, DZ, ATV, Apple Music Android e plataformas de vídeo | RF-15 (SC-PERSONAL) | Teste em device |
| PND-15 | Teste §4.4: Atalho iOS no share sheet de IG/TT/YT | Contingência RF-01 | Teste em device |
| PND-16 | SEC-CTRL-31 construído e verificado antes de qualquer uso de P-IOS-SHORTCUTS (GAP-05, T-28 Crítica) | P-IOS-SHORTCUTS | Você (Fase 1, se a contingência for escolhida) |
| PND-17 | Spikes autenticados não executados: SPIKE-06 (TMDB), 07 (Spotify), 08 (Anthropic), 09 (Apple Music), 10 (Meta) | Confirmação prática de GO COM RESTRIÇÃO | Você (com credenciais, após liberação de ToS) |
| PND-18 | Compatibilidade do `expo-share-intent` com a New Architecture e o custo do workaround com Expo Router | P-SHARE-PLUGIN | Você (spike) |
| PND-19 | Spotify Development Mode exige que o dono do app tenha Premium ativo | P-SPOT RF-15 | Você |
| PND-20 | MusicKit/Music User Token no Android não avaliado | P-AM Android | Você (reexecutar o feasibility scout) |
| PND-21 | Definição da hospedagem do backend (GAP-01) e disponibilidade regional da API Anthropic nela | P-LLM, T-04 | Você |
| PND-22 | Integração de ML Kit/Apple Vision dentro do Expo (módulo nativo) não avaliada | P-MLKIT via Expo | Você (reexecutar o feasibility scout) |
| PND-23 | Limites de memória da Share Extension (verificação de SEC-CTRL-01 com Instruments) | RF-01 iOS | Teste em device (Fase 1) |

---

## 6. Decisões que preciso tomar

1. **Cenário-alvo da Fase 1.** (a) Só SC-PERSONAL: desbloqueia mais rápido, mas SC-STORE vira retrabalho posterior. (b) SC-PERSONAL agora, com a arquitetura já preparada para SC-STORE (feature flags, RLS, SEC-REQ-16/21 desde o início): custo inicial maior, menos retrabalho. (c) Os dois em paralelo: esbarra agora em PEND-09, na Extended Quota do Spotify e em 4.2.2, sem prazo de resolução.
2. **Monetização.** (a) Gratuito, sem monetização: mantém TMDB, MusicBrainz core e Apple Music no regime atual, mas não resolve a Deezer (loja já conta como comercial). (b) Monetizado: exige acordos escritos com TMDB (TOS-REQ-04) e possivelmente MetaBrainz/Deezer, além de cuidado com TOS-REQ-13, antes de SC-STORE.
3. **Stack de share (RF-01).** (a) Aprovar Expo + `expo-share-intent` condicionado a PND-02 e PND-03: melhor evidência atual, mas iOS ainda não comprovado e mantenedor único. (b) Igual a (a), mais um spike paralelo de `expo-share-extension`: reduz o risco de dependência ao custo de um spike extra. (c) Contingência Atalho iOS + PWA Android, só para SC-PERSONAL: sem paridade, travado em 1 usuário e exige SEC-CTRL-31 antes.
4. **Bloqueio do LLM por LGPD (PEND-10) em SC-PERSONAL.** (a) Resolver PEND-10 antes de iniciar a Fase 1: mais seguro, pode atrasar. (b) Iniciar a Fase 1 com dados sintéticos/sem PII e só processar conteúdo real após PEND-10: não atrasa, exige disciplina de dados de teste. (c) Aceitar explicitamente o risco em SC-PERSONAL: é a mais rápida, mas contraria o fail-closed e a decisão precisa ficar registrada como sua.
5. **Escopo do RF-15 no MVP.** (a) Música via Spotify (busca + deep link; playlist só na allowlist de ≤ 5) + Apple Music iOS; vídeo apenas como "disponível em" via TMDB: entregável agora, mas RF-15 de vídeo fica degradado. (b) Igual a (a), mais investimento em PEND-04 e no teste §4.2 para liberar deep link de vídeo em SC-PERSONAL: melhor experiência pessoal, custo de parecer/contato e nenhum ganho em SC-STORE.

CHECKPOINT: aguardando aprovação explícita antes da Fase 1.

---

## 7. Rodada PRE-04 (2026-09-28)

Agente: `phase0-arbiter`. Nenhuma pesquisa nova. As seções 1 a 6 acima não foram alteradas. Onde esta seção diverge delas, **esta seção prevalece**, e cada divergência aparece em 7.5.

Insumos lidos:
- `tos-report.md`: linhas da §2 com "Acessado em: 2026-09-28", §3 (TOS-REQ-38 a 44), §4 (linhas e observações PRE-04), §5 (PEND-03 marcada como RESOLVIDA, PEND-18 a 21) e §6.
- `integration-feasibility.md`: §5 (SPIKE-15), §6 (pendências 23 a 27) e §8.
- `security-threat-model.md`: §6 (T-31 a T-42, SEC-CTRL-42 a 52, SEC-REQ-25 a 33, GAP-09 a 14).
- Contexto: `platforms.md`, `decisions.md` (D-01 a D-06), `docs/spec/delta-v2.md`, `docs/spec/taxonomy-v1.md` e `docs/spec/phases-v2.md`.

Critérios: os mesmos 1 a 7 do início do documento, mais três:
8. **D-06 é um aceite de risco seu, não uma evidência.** Ele é respeitado, mas só no alcance que o próprio texto dele define: SC-PERSONAL, texto digitado pelo próprio usuário e "um resumo do próprio gosto". Ele não resolve gaps de segurança.
9. Uma capacidade sem linha em `platforms.md` e sem análise no `tos-report.md` recebe ToS `NÃO AVALIADO` e fica `BLOQUEADO` (é o critério 3 aplicado a itens novos).
10. Quando a PCC do auditor depende de uma premissa que os relatórios não comprovam, vale o critério 5. É o que acontece com a Seção 1.C do TMDB (ver 7.2).

### 7.1 Matriz de decisão das capacidades novas

| Platform ID | RF | Capacidade | ToS | Viabilidade | Segurança | SC-PERSONAL | SC-STORE | Restrições/condições |
|---|---|---|---|---|---|---|---|---|
| P-TMDB | RF-32 (K), RF-35, RF-39 | discover, keywords, recommendations e similar como candidatos externos, com ranking local determinístico | P: PCC / S: PCC (auditor), **condicionado à premissa de que o Fruiqo não é "AI based Application"**, que não está comprovada (C-15) | VIÁVEL (SPIKE-15: 8 chamadas com HTTP 200, mais recommendations/similar de série). Rate limit: VCL (~40 req/s prático, não contratual, sem headers `X-RateLimit-*`) | SEC-CTRL-10, 25, 37 (a rodada PRE-04 não trouxe ameaça nova) | `BLOQUEADO` | `BLOQUEADO` | Fail-closed pela leitura ampla da Seção 1.C (7.2). **Se C-15 for resolvida na leitura (a): `GO COM RESTRIÇÃO` nos dois cenários**, com TOS-REQ-01, 02, 39 e TOS-REQ-04 (SC-STORE só enquanto for gratuito, D-02), mais ARB-REQ-02 e ARB-REQ-06. Throttle global (SEC-CTRL-37), já que não há quota publicada. |
| P-TMDB | RF-38 (e RF-06) | Watch providers BR com crédito à JustWatch | P: PCC / S: PCC (TOS-REQ-38 é novo). Herda C-15 | VIÁVEL (SPIKE-15: 92 provedores para filme e 77 para série, em BR) | SEC-CTRL-10, 25, 37 | `BLOQUEADO` | `BLOQUEADO` | Herda C-15. Na leitura (a): `GO COM RESTRIÇÃO` com TOS-REQ-01 **e** TOS-REQ-38 (crédito à JustWatch em **cada** exibição, não só na tela "Sobre") e cache ≤ 180 dias. Nenhum consumo direto da API da JustWatch (TOS-REQ-18). O delta cita só TOS-REQ-01 (C-19). |
| P-TMDB | RF-05/RF-15 (saída) | Link de saída para imdb.com a partir do `imdb_id` | P: PERMITIDO / S: PERMITIDO (sem logo IMDb e sem chamada automatizada ao imdb.com) | **NÃO AVALIADO** pelo feasibility: `/movie/{id}/external_ids` não foi exercitado no SPIKE-15 e aparece só no tos-report | SEC-CTRL-27; SEC-REQ-12 (link de saída só com ID público) | `BLOQUEADO` | `BLOQUEADO` | Duas causas: a viabilidade não foi avaliada, e o `imdb_id` é conteúdo TMDB (herda C-15). Desbloqueio barato: uma chamada a `external_ids` no próximo spike, mais a resolução de C-15. Formato fixo `https://www.imdb.com/title/{imdb_id}/`. |
| P-TMDB, P-SPOT → P-LLM | RF-32, RF-33, RF-39 | Qualquer dado do TMDB ou do Spotify como input/contexto do LLM, inclusive dado **derivado** deles | PROIBIDO / PROIBIDO (TMDB, Seção 1.C; Spotify, Seção III.14 "otherwise ingest") | N/A | SEC-CTRL-46 (o LLM só recebe `<user_text>`) | `NO-GO` | `NO-GO` | TOS-REQ-12, 39, 41. **Substitui a linha "Metadado TMDB como contexto do LLM" da seção 1b** (era AMBÍGUO/BLOQUEADO; PEND-03 foi resolvida pelo auditor). Inclui título/ano normalizados pelo TMDB e afinidades calculadas a partir de gêneros/keywords do TMDB (C-16, C-17). ARB-REQ-06. |
| P-SPOT | RF-35, RF-39 | `GET /recommendations` e `GET /artists/{id}/related-artists` (e também `audio-features`/`audio-analysis`) | PROIBIDO (indisponível) / PROIBIDO (indisponível) | INVIÁVEL (HTTP 403 para apps criados depois de 27/11/2024, sem substituto oficial) | N/A | `NO-GO` | `NO-GO` | TOS-REQ-40. Não existe caminho do tipo "parecido com X" no Spotify. |
| P-SPOT | RF-34, RF-35, RF-39 | Usar `/search` como insumo de ranking ou perfil | P: PCC **condicionada a consultar o Spotify antes de usar como ranking** (TOS-REQ-41, PEND-19) / S: AMBÍGUO (Seção III.13) | VCL (`search` documentado; SPIKE-07 não executado; sem recomendação automática) | SEC-CTRL-10, 25, 37 | `BLOQUEADO` | `BLOQUEADO` | Critério 5 em SC-PERSONAL: a própria PCC só vale se o `/search` **não** virar insumo de ranking. O `/search` continua `GO COM RESTRIÇÃO` apenas para exibição (RF-05, seção 1a). Consequência: a descoberta externa de música fica sem fonte (ARB-REQ-07). |
| P-LLM | RF-33, RNF-06 | "Como estou" com LLM (Anthropic) sobre o texto do próprio usuário | P: PCC (a Usage Policy exclui "wellness advice" da categoria Healthcare; TOS-REQ-42, 44). A PEND-10 fica coberta **só** pelo aceite de risco da D-06 / S: PCC + PEND-10 (NÃO VERIFICADO) + PEND-20 (parecer) | VIÁVEL (doc; SPIKE-08 não executado; a chave ainda está pendente, PRE-02) | T-37 (Alta): SEC-CTRL-46 implementado. T-38 (Crítica): SEC-CTRL-47 implementado, com residual GAP-11. **T-39 (Alta) sem controle: GAP-12, SEC-CTRL-50 não implementado. T-40 (Alta) sem controle: GAP-13, SEC-CTRL-51 não implementado.** T-41 (Média): GAP-14 | `BLOQUEADO` | `BLOQUEADO` | Regra: GAP sem controle para ameaça Alta → BLOQUEADO. **SC-PERSONAL desbloqueia com SEC-CTRL-50 e 51 construídos e verificados**, mais o disclosure de IA da TOS-REQ-42. SC-STORE também exige PEND-10, PEND-20, revisão profissional da lista de risco (GAP-11) e SEC-CTRL-52. Só o texto digitado vai ao LLM; o resumo de gosto não vai (C-16). |
| — (local) | RF-33, RNF-06 | "Como estou" no modo `rules` (sem rede) | Sem terceiro envolvido. LGPD: TOS-REQ-44 (dado sensível por fail-closed) | N/A (código local) | T-39 (Alta) sem controle. Vale em **qualquer** `AI_MODE`, porque a retenção é de `recommendation_runs.intent` | `BLOQUEADO` | `BLOQUEADO` | Desbloqueio: SEC-CTRL-50. SC-STORE também exige PEND-20. |
| P-LLM / local | RNF-07 | Detecção local de risco e encaminhamento ao CVV 188 / cvv.org.br / SAMU 192 antes de qualquer sugestão | P: PCC / S: PCC, com PEND-10 como condição adicional do auditor. Alinhado à Usage Policy; TOS-REQ-43 | N/A (código local; gate de recall no CI) | T-38 (Crítica): SEC-CTRL-47 implementado. O residual é inerente ao desenho (GAP-11) | `GO COM RESTRIÇÃO` | `BLOQUEADO` | SC-PERSONAL: detector obrigatório em todo `AI_MODE`, sempre antes do LLM, com recall de 100% no CI (SEC-REQ-33). Não depender de classificador da Anthropic (PEND-18). Esta linha é GO mesmo com o "Como estou" bloqueado, porque é a proteção dele. SC-STORE: PEND-10 (condição do auditor), PEND-20 e revisão da lista por profissional de saúde mental (GAP-11). |
| — (biblioteca `expo-pdf-text-extract`, sem Platform ID) | RF-18b | Extração de texto de PDF on-device | **NÃO AVALIADO**: não tem linha em `platforms.md` nem no tos-report; a licença MIT foi citada só pelo feasibility | VCL documental. Build com SDK 57 e New Architecture **NÃO VERIFICADO** (pendências 25 e 27). Pacote criado em 2026-01-14, com mantenedor único | SEC-REQ-02, 03 (limites de 10 MB/20 páginas; parsing com limites); SEC-CTRL-02, 05, 30 | `BLOQUEADO` | `BLOQUEADO` | Para desbloquear: incluir em `platforms.md`, passar pelo auditor de ToS/licença e fazer um spike de build equivalente ao SPIKE-12/14. Nenhum fallback mantido foi identificado. |
| P-EXPO (`expo-image-picker`, `expo-document-picker`) | RF-40 | Importar prints pelo seletor do sistema, sem permissão de galeria | P: PCC (linha P-EXPO "Expo SDK") / S: PCC para o SDK. **O efeito, na política de loja, da entrada `READ/WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`) no manifest mesclado não foi analisado** | VCL: no iOS não há permissão (PHPicker/UIDocumentPicker). No Android, pelo código-fonte, não há prompt em API 33+, mas isso **não foi testado em device**. O critério literal do RF-40 falha, porque o manifest mesclado contém as entradas | T-42 (Baixa): reusa SEC-CTRL-02, 03, 29, 30 | `GO COM RESTRIÇÃO` | `BLOQUEADO` | Só imagens; PDF pelo seletor herda o RF-18b. O critério de aceite 1 precisa de decisão (Decisão 5, C-20). SC-STORE: análise do auditor sobre a entrada de permissão e teste em device Android 13+. |
| — (`apps/web`, sem Platform ID) | F-11 (RF-24 a RF-30) | Sistema web | Não há integração própria com terceiros. O **hosting do `apps/web` não está em `platforms.md`** (NÃO AVALIADO, mesmo caso de C-14). A busca manual no TMDB (RF-27) e o rematch herdam C-15 | Implementado. F-11 não foi avaliado pelo feasibility | T-31: SEC-CTRL-42 implementado. T-32 (Alta): SEC-CTRL-43 implementado, mas a 2ª camada (SEC-CTRL-48) não, ver GAP-09. T-33 e T-34 (Média) sem controle (GAP-09, GAP-10). T-35: SEC-CTRL-44 implementado. T-36: SEC-CTRL-45 implementado | `GO COM RESTRIÇÃO` (uso local/dev) | `BLOQUEADO` | Publicar o web em hosting fica BLOQUEADO até o hosting entrar em `platforms.md` e ser avaliado. Antes disso: SEC-CTRL-49 antes de qualquer deploy com `NODE_ENV=production`, e SEC-CTRL-48 junto com a definição do hosting (o próprio GAP-09 diz "aceitável só até a definição do hosting"). SC-STORE também exige SEC-REQ-16/21. |
| P-LLM | RF-32 (L) | Tag de subgênero feita pelo LLM a partir de título/ano | Não classificado em linha própria. Se o título/ano vier do registro TMDB: PROIBIDO (TOS-REQ-39). Se vier de texto de origem do usuário: PCC. LGPD: o título/ano do catálogo faz parte do histórico de consumo (dado pessoal); a D-06 não cita itens do catálogo, e conteúdo de share continua sob a D-04 | VIÁVEL (doc; SPIKE-08 não executado) | SEC-CTRL-46 (mesmo padrão) | `BLOQUEADO` | `BLOQUEADO` | C-17. Na leitura ampla de C-15, é o caso mais direto de uso "in connection with". SC-PERSONAL desbloqueia com C-15 na leitura (a), ARB-REQ-06 e a sua confirmação de que a D-06 cobre esse envio. SC-STORE também exige PEND-10. |

**Efeito sobre a seção 1a:** enquanto C-15 estiver aberta, as linhas P-TMDB RF-05 (busca) e RF-06 (watch providers) da seção 1a, que estavam `GO COM RESTRIÇÃO`, passam a `BLOQUEADO` nos dois cenários pelo mesmo motivo (7.2). Isso também afeta o item "TMDB busca + watch providers BR" da seção 3.

### 7.2 Verificação cruzada: Seção 1.C dos termos do TMDB

Texto citado verbatim no tos-report (§2, linha P-TMDB RF-33/RF-39, 2026-09-28): *"Use the TMDB APIs or TMDB Content in connection with, including for training, a machine learning (ML) or artificial intelligence (AI) based Application."*

**O que o auditor fez.** Classificou dois pontos:
- Enviar dado do TMDB ao LLM: PROIBIDO. O argumento é que "in connection with" é mais amplo que "for training".
- Ranking local com dados do TMDB: PCC. O argumento é que o ranking "não constitui, em si, uma aplicação de ML/IA".

Com isso, marcou a PEND-03 como resolvida.

**A tensão.** O auditor lê "in connection with" de forma **ampla** para chegar à proibição, mas lê "AI based Application" de forma **estreita**: aplica o termo ao componente de ranking, não ao aplicativo. Nenhum dos três relatórios cita uma definição de "Application" ou de "AI based" nos termos do TMDB, nem uma manifestação do TMDB sobre apps que têm recursos de IA mas não enviam dado do TMDB ao modelo. A PEND-03 perguntava sobre RAG/grounding e foi resolvida só para essa pergunta. A questão do escopo continua aberta. Está registrada como **C-15**.

**O Fruiqo tem LLM em mais lugares do que o "Como estou":**
- RF-03/04: extração de conteúdo compartilhado. É o núcleo do produto, e a saída é resolvida no TMDB (pipeline LLM → TMDB, ARB-REQ-02).
- RF-32 (L): tag de subgênero.
- RF-33: interpretação do humor.

Por isso, desligar só o "Como estou" não resolve a leitura (b).

| | Leitura (a), restrita (adotada pelo auditor) | Leitura (b), ampla |
|---|---|---|
| O que é vedado | Enviar qualquer dado do TMDB (inclusive derivado) a modelo de ML/IA, seja para treino ou em inferência | Usar a API/conteúdo do TMDB em um app que seja "AI based". Um app com recursos de LLM poderia ser enquadrado, mesmo que o TMDB nunca chegue ao modelo |
| Evidência nos relatórios | Texto verbatim da 1.C, mais a interpretação do auditor | Nenhuma evidência a favor nem contra. A leitura não é refutada: faltam a definição de "Application" e uma resposta do TMDB |
| Impacto no produto | RF-05, 06, 32 (K), 35, 38 e 39 de vídeo seguem como `GO COM RESTRIÇÃO` nos dois cenários. A exigência passa a ser disciplina de dados: TOS-REQ-39 e ARB-REQ-06, com teste automatizado sobre o builder de prompt | TMDB e LLM ficam **mutuamente exclusivos** no mesmo app. (b1) Manter o TMDB e remover o LLM: RF-03/04 perdem a extração por LLM (a viabilidade de extração só por OCR + regras não foi avaliada), acaba a tag L e o "Como estou" fica só com regras. (b2) Manter o LLM e remover o TMDB: filmes e séries perdem resolução (RF-05), disponibilidade (RF-06/38) e descoberta (RF-32/35/39), e os relatórios não avaliaram nenhuma fonte substituta (a JustWatch é NO-GO). A música não é afetada |
| Status resultante | TMDB: `GO COM RESTRIÇÃO` | TMDB: `NO-GO` enquanto houver LLM no app |

**Decisão fail-closed:** vale a leitura **(b)** até existir evidência. Com isso, todas as capacidades do TMDB ficam `BLOQUEADO` nos dois cenários, inclusive RF-05/RF-06 da seção 1a. Escolhi `BLOQUEADO` e não `NO-GO` porque a proibição vem de uma leitura possível do texto, não de uma leitura confirmada.

Estado atual, só como registro: a chave da Anthropic está pendente (PRE-02), o `AI_MODE` vem desligado por padrão e a D-04 limita o conteúdo real. Ou seja, hoje nada vai ao LLM em uso real. Os relatórios não dizem se um app com código de LLM desligado conta como "AI based Application". Isso **reduz** o risco, mas **não é evidência** de conformidade.

**O que resolveria:**
1. Resposta **escrita** do TMDB, por canal oficial, datada e arquivada em `docs/phase0/`, à pergunta exata: *"Um app que usa um LLM apenas sobre o texto digitado pelo usuário e sobre o conteúdo que ele compartilha, e que nunca envia dados ou conteúdo da API TMDB a nenhum modelo de ML/IA, é um 'AI based Application' pela Seção 1.C?"*
2. Uma nova execução do tos-compliance-auditor para obter o texto integral dos TMDB API Terms, incluindo qualquer seção de definições ou FAQ oficial sobre "Application". Os relatórios atuais não citam nenhuma.
3. Opcional: parecer jurídico.

**Não resolvem:** a opinião do auditor sozinha, posts de usuários em fórum e a D-06 (que pressupõe a leitura (a), mas é uma decisão sua, não uma evidência).

### 7.3 Status dos itens `DEPENDE DA FASE 0` do delta v2 (e dos que mudaram por efeito desta rodada)

| Item do delta | Status no delta | Status após PRE-04 (fail-closed) | Se C-15 for resolvida na leitura (a) | Motivo |
|---|---|---|---|---|
| RF-18b (PDF on-device) | `DEPENDE DA FASE 0` | `BLOQUEADO` / `BLOQUEADO` | Sem efeito | A biblioteca não passou pela análise de ToS/licença e o build não foi verificado (pendências 25, 27) |
| RF-32, parte K (keywords) | `DEPENDE DA FASE 0` | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` / `GO COM RESTRIÇÃO` | ToS PCC + SPIKE-15 viável; resta C-15 |
| RF-32, parte R (regra local sobre gêneros do TMDB) | Sem marcação | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` / `GO COM RESTRIÇÃO` | Os gêneros vêm do TMDB (C-15) |
| RF-32, parte L (tag do LLM) | "exige `AI_MODE=anthropic` (D-06)" | `BLOQUEADO` / `BLOQUEADO` | Continua `BLOQUEADO` até C-17 e o escopo da D-06 | Origem do título/ano e alcance da D-06 (C-17) |
| RF-35 externo (vídeo) | `DEPENDE DA FASE 0` | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` / `GO COM RESTRIÇÃO` | C-15 |
| RF-35 externo (música) | `DEPENDE DA FASE 0` | recommendations/related-artists: `NO-GO`; `/search` como insumo: `BLOQUEADO` | Sem efeito | TOS-REQ-40; PEND-19 |
| RF-39 externo | `DEPENDE DA FASE 0` | Igual ao RF-35 (vídeo `BLOQUEADO`; música `NO-GO`/`BLOQUEADO`) | Vídeo: `GO COM RESTRIÇÃO` | Idem |
| RF-38 (disponibilidade) | "GO COM RESTRIÇÃO (TOS-REQ-01)" | **Rebaixado** para `BLOQUEADO` / `BLOQUEADO` e passa a exigir TOS-REQ-38 | `GO COM RESTRIÇÃO` + TOS-REQ-38 | C-15, C-19 |
| RF-33 em SC-PERSONAL (D-06) | Liberado pela D-06 | **Rebaixado** para `BLOQUEADO` | Sem efeito | GAP-12/13 (T-39, T-40 Altas sem controle). Desbloqueia com SEC-CTRL-50 e 51 |
| RF-33 em SC-STORE | `DEPENDE DA FASE 0` (PEND-10) | `BLOQUEADO` | Sem efeito | PEND-10, PEND-20, GAP-11, 12, 13, 14 |
| RNF-06 em SC-STORE | `DEPENDE DA FASE 0` (PEND-09/10) | `BLOQUEADO` | Sem efeito | PEND-10, PEND-20. O critério 3 (toggle) não está implementado (C-18) |
| RNF-07 | Sem marcação | `GO COM RESTRIÇÃO` / `BLOQUEADO` | Sem efeito | SEC-CTRL-47 implementado; SC-STORE depende de GAP-11 e PEND-10/20 |
| RF-40 (imagens) | Fase 2b | `GO COM RESTRIÇÃO` / `BLOQUEADO` | Sem efeito | O critério 1 precisa de reformulação (C-20) |
| RF-40 (PDF pelo seletor) | `DEPENDE DA FASE 0` (RF-18b) | `BLOQUEADO` / `BLOQUEADO` | Sem efeito | Herda o RF-18b |

Resumo: **nenhum item passa a `GO` sob fail-closed.** RF-32 K/R, RF-35/39 de vídeo e RF-38 passariam a `GO COM RESTRIÇÃO` apenas com C-15 resolvida na leitura (a).

### 7.4 Requisitos herdados novos

#### 7.4.1 Obrigações de ToS/LGPD (`tos-report.md`, PRE-04)

| ID | Requisito | Origem | Escopo | Atendido no código? (segundo os relatórios) |
|---|---|---|---|---|
| TOS-REQ-38 | Crédito/logo da JustWatch em **cada** exibição de watch providers, além da atribuição geral do TMDB | P-TMDB | Ambos | Não verificado. O delta RF-38 não o prevê (C-19) |
| TOS-REQ-39 | Nenhum dado do TMDB (inclusive derivado) como input/contexto do LLM; ranking 100% local | P-TMDB | Ambos | Não verificado por teste. SEC-CTRL-46 só garante `<user_text>` delimitado (ver ARB-REQ-06) |
| TOS-REQ-40 | Não depender de `/recommendations` nem de `/related-artists` do Spotify | P-SPOT | Ambos | Coerente com a D-05; não verificado |
| TOS-REQ-41 | Nenhum metadado do Spotify no LLM nem como fonte de perfil/analytics; consultar o Spotify antes de usar `/search` no ranking | P-SPOT | Ambos | Não verificado (ARB-REQ-06, 07) |
| TOS-REQ-42 | Disclosure explícito de IA no "Como estou" na primeira sessão com `AI_MODE=anthropic` | P-LLM | Ambos | Parcial, segundo o tos-report ("parcialmente coberta pelo opt-in de RNF-06"). Falta confirmar |
| TOS-REQ-43 | Detector local de risco como controle primário em todo `AI_MODE`; não depender de classificador da Anthropic | P-LLM | Ambos | **Atendido** (SEC-CTRL-47 implementado) |
| TOS-REQ-44 | "Como estou" tratado como dado sensível: consentimento específico, minimização e exclusão | P-LGPD | Ambos | **Parcial**: o texto bruto não é persistido e o `DELETE /profile/mood-history` existe; o toggle `remember_mood` e o TTL **não** existem (GAP-12, C-18) |

A PEND-03 foi resolvida para RAG/grounding. A TOS-REQ-39 substitui a incerteza da TOS-REQ-03, que continua valendo para treino.

#### 7.4.2 Requisitos de segurança (`security-threat-model.md` §6.4)

| ID | Requisito (resumo) | Controle | Estado no código |
|---|---|---|---|
| SEC-REQ-25 | CSP própria do `apps/web` + anti-clickjacking no hosting | SEC-CTRL-48 | **Não implementado** (GAP-09) |
| SEC-REQ-26 | Rotas mutáveis do web só com Bearer em memória; cookie só para refresh em `Path=/auth` | SEC-CTRL-43 | Implementado |
| SEC-REQ-27 | `WEB_ORIGIN` só com `https://` em produção, fail-closed no boot | SEC-CTRL-49 | **Não implementado** (GAP-10) |
| SEC-REQ-28 | Bulk, undo, merge e revisão revalidam dono e estado sob RLS; undo de uso único | SEC-CTRL-45 | Implementado |
| SEC-REQ-29 | Intenção de humor só é retida com opt-in "lembrar meu humor"; purga em ≤ 90 dias | SEC-CTRL-50 | **Não implementado** (GAP-12) |
| SEC-REQ-30 | `AI_MODE=anthropic` só para usuário com consentimento individual registrado | SEC-CTRL-51 | **Não implementado** (GAP-13) |
| SEC-REQ-31 | Quotas de LLM em mecanismo durável e compartilhado (Redis) | SEC-CTRL-52 | **Não implementado** (GAP-14) |
| SEC-REQ-32 | CI verifica `fixtures/` (`synthetic=true`, allowlist de tipos, `fixtures-private/` no `.gitignore`) | Sem SEC-CTRL numerado | Não informado pelo threat model |
| SEC-REQ-33 | Detector de risco antes de qualquer LLM, inclusive em "continuar"; texto de risco não persistido; recall como gate de CI | SEC-CTRL-47 | Implementado |

**Controles que o código atual ainda não atende:**
- **SEC-CTRL-48** (CSP do web). Quando: junto com a definição do hosting.
- **SEC-CTRL-49** (`https` obrigatório). Quando: antes de qualquer deploy de produção.
- **SEC-CTRL-50** (`remember_mood` + TTL de 90 dias). Quando: antes de usar o "Como estou" com dado real, em qualquer modo.
- **SEC-CTRL-51** (consentimento individual de IA). Quando: antes de ligar `AI_MODE=anthropic` com dado real.
- **SEC-CTRL-52** (quota no Redis). Quando: antes de rodar réplicas e antes de SC-STORE.

#### 7.4.3 Restrições derivadas desta arbitragem

| ID | Restrição | Motivo |
|---|---|---|
| ARB-REQ-06 | Nenhum valor originado **ou derivado** de TMDB/Spotify entra em prompt de LLM. Isso inclui título/ano normalizados pelo TMDB, gêneros, subgêneros e keywords resolvidos pelo TMDB, afinidades calculadas a partir deles e dados de disponibilidade. O LLM recebe apenas texto digitado pelo usuário e strings de origem do usuário (share/OCR, estas sujeitas à D-04), além dos enums próprios da taxonomia sem valores. Verificação: teste automatizado sobre o builder de prompt. | TOS-REQ-39, 41; C-16, C-17 |
| ARB-REQ-07 | Enquanto a PEND-19 estiver aberta, RF-35/39 de música usam só candidatos do catálogo do usuário, e o `/search` do Spotify serve só para exibição e resolução (RF-05). | TOS-REQ-40, 41 |
| ARB-REQ-08 | O "Como estou" não processa texto real (em nenhum `AI_MODE`) antes de SEC-CTRL-50 existir, e o `AI_MODE=anthropic` não é ligado com dado real antes de SEC-CTRL-51 existir. | T-39, T-40; GAP-12, 13 |

### 7.5 Contradições e pendências novas

#### 7.5.1 Contradições

| ID | Contradição | Arbitragem | Dono sugerido |
|---|---|---|---|
| C-15 | O tos-report dá PCC ao ranking com TMDB porque o ranking "não é, em si", uma aplicação de IA. Mas a Seção 1.C fala de "AI based Application", e o Fruiqo tem LLM em RF-03/04, RF-32 L e RF-33. Os relatórios não trazem a definição de "Application" nem uma posição do TMDB. | Fail-closed pela leitura ampla: todo uso do TMDB fica `BLOQUEADO` (7.2). A PEND-03 foi resolvida só para RAG. | Contato com plataforma (TMDB) + você (reexecutar o auditor para obter as definições) |
| C-16 | A D-06 autoriza enviar à Anthropic "um resumo do próprio gosto". O delta (C-V2-04) e o tos-report (linha P-SPOT RNF (AI)) dizem que o LLM recebe só título/ano e o texto do humor. As afinidades de gosto são calculadas sobre gêneros/subgêneros mapeados de IDs do TMDB (taxonomia v1) e seriam "dado derivado do TMDB" (TOS-REQ-39). | Fail-closed: o resumo de gosto **não** vai ao LLM (ARB-REQ-06). A D-06 fica parcialmente limitada até você confirmar. | Você |
| C-17 | O RF-32 L envia "título/ano do conteúdo do usuário", mas não diz a origem da string. Depois da resolução, o título/ano canônico é conteúdo do TMDB. A D-06 cobre texto digitado, e o conteúdo de share está sob a D-04. | `BLOQUEADO` até a spec fixar que só strings de origem do usuário são enviadas e até você confirmar o alcance da D-06. | Você (spec) |
| C-18 | O tos-report (§6 item 4 e TOS-REQ-44) afirma que o toggle "lembrar meu humor" OFF por padrão "já [é] atendido" pelo desenho da RNF-06. O threat model, lendo o código, diz que `remember_mood`/`user_settings` não existem e que a intenção é retida indefinidamente (T-39, GAP-12). | Sobre o estado da implementação, prevalece o threat model. A TOS-REQ-44 está só parcialmente atendida. | Você |
| C-19 | O delta RF-38 marca a dependência como "GO COM RESTRIÇÃO (atribuição TOS-REQ-01)". A PRE-04 acrescenta a TOS-REQ-38 (crédito à JustWatch em cada exibição), e C-15 bloqueia o TMDB. | O delta precisa ser atualizado. Status atual: `BLOQUEADO`. | Você |
| C-20 | O critério de aceite 1 do RF-40 exige "manifest sem `READ_EXTERNAL_STORAGE`". O feasibility mostra que o `expo-image-picker` injeta essa entrada (com `maxSdkVersion=32`) no manifest mesclado, embora não peça a permissão em runtime em API 33+. | O critério literal falha. Não há alternativa avaliada. Depende da Decisão 5. | Você + teste em device |
| C-21 | A pendência 23 do feasibility diz que o tos-report era "inexistente na rodada anterior", mas a matriz de 2026-09-27 já o usa. O SPIKE-15 respeitou a ARB-REQ-03 no nível da plataforma (P-TMDB já era PCC), mas os relatórios não registram se ele rodou antes ou depois da classificação das capacidades discover/keywords/recommendations. | Erro de registro, sem efeito sobre a decisão. Nenhuma resposta bruta foi gravada (TOS-REQ-02 respeitada). | Você |
| C-22 | O tos-report classifica RF-33/RNF-07 em SC-PERSONAL como PCC **sem** a condição PEND-10, enquanto a TOS-REQ-29 não distingue cenário (C-12). | Aceito apenas porque a D-06 é o seu aceite de risco explícito, e só no alcance dela. Não vale para conteúdo de share (D-04) nem para outros usuários (T-40). | Você |

#### 7.5.2 Pendências

| ID | Pendência | Bloqueia | Dono sugerido |
|---|---|---|---|
| PND-24 | C-15: resposta escrita do TMDB + texto integral dos termos (definições). Substitui a PND-08 no que diz respeito ao escopo | Todo uso do TMDB (RF-05, 06, 32, 35, 38, 39) | Contato com plataforma (TMDB) + você (reexecutar o auditor) |
| PND-25 | PEND-18: saber se a API da Anthropic tem classificador de crise | Nada (a TOS-REQ-43 já cobre) | Contato com plataforma (Anthropic) |
| PND-26 | PEND-19: Seção III.13 do Spotify × `/search` como insumo de ranking | RF-35/39 de música | Contato com plataforma (Spotify) ou parecer jurídico |
| PND-27 | PEND-20: saber se o humor não clínico é dado de saúde | RF-33 e RNF-06 em SC-STORE | Parecer jurídico |
| PND-28 | PEND-21: texto verbatim dos Art. 5º II, 11 e 20 da LGPD (o fetch falhou) | Decisões que dependem da redação exata | Você (reexecutar o auditor) |
| PND-29 | `expo-pdf-text-extract`: entrada em `platforms.md`, análise de licença/ToS e spike de build com SDK 57/New Architecture (pendências 25, 27) | RF-18b, RF-40 (PDF) | Você + tos-compliance-auditor |
| PND-30 | RF-40: teste em device Android 13+ (sem prompt de permissão), análise do auditor sobre a entrada de permissão no manifest em loja, e definir o suporte a Android ≤ 12L | RF-40 em SC-STORE | Teste em device + auditor + você |
| PND-31 | Construir SEC-CTRL-48 a 52, na ordem indicada em 7.4.2 | RF-33, RNF-06, F-11 | Você |
| PND-32 | GAP-11: revisão da lista de padrões de risco por profissional de saúde mental ou serviço parceiro | RNF-07 e RF-33 em SC-STORE | Você (contratar a revisão ou fazer contato) |
| PND-33 | Hosting do `apps/web` (e do backend, PND-21): entrada em `platforms.md`, ToS e segurança (GAP-01, GAP-09) | Publicação do F-11 | Você |
| PND-34 | Spike de `GET /movie/{id}/external_ids` (link de saída para o IMDb) | Link para imdb.com | Você |
| PND-35 | Confirmar no código o disclosure de IA (TOS-REQ-42) e implementar o crédito à JustWatch (TOS-REQ-38) | RF-33 (IA), RF-38 | Você |
| PND-36 | Fixar o alcance da D-06 (resumo de gosto, título/ano do catálogo) diante de C-16/C-17 | RF-32 L, RF-33 | Você |

### 7.6 Decisões que preciso tomar

1. **C-15: TMDB em um app com IA.**
   - (a) Manter o TMDB bloqueado até a resposta escrita do TMDB: fail-closed pleno, mas congela filmes e séries (RF-05, 06, 32, 35, 38, 39) sem prazo.
   - (b) Registrar o aceite de risco da leitura restrita só em SC-PERSONAL (como na D-06) e seguir, com SC-STORE esperando a resposta: destrava agora, com o risco de ter de retirar depois o TMDB ou o LLM.
   - (c) Manter o TMDB e desligar todo uso de LLM até a resposta: preserva filmes e séries, mas perde a extração por LLM, a tag L e o "Como estou" com IA, e ainda assim não prova conformidade.
   - (d) Manter o LLM e retirar o TMDB: nenhum substituto foi avaliado, e filmes e séries ficam sem metadados nem disponibilidade.
2. **"Como estou" em SC-PERSONAL.**
   - (a) Construir SEC-CTRL-50 e 51 antes de usar com texto real: segue a regra, com trabalho de backend pequeno e já especificado.
   - (b) Construir só o SEC-CTRL-50 e aceitar formalmente o GAP-13, mantendo `ALLOWED_EMAILS` com 1 e-mail: um pouco mais rápido, mas o risco volta assim que entrar um segundo usuário.
   - (c) Aceitar temporariamente os GAP-12 e 13: o mais rápido, mas retém dado sensível sem TTL, contraria a TOS-REQ-44 e o fail-closed, e precisa ficar registrado como decisão sua.
3. **Descoberta externa de música (RF-35/39).**
   - (a) Música só a partir do catálogo do usuário: sem risco, mas sem descoberta.
   - (b) Consultar o Spotify (PEND-19) antes de usar o `/search` como insumo de ranking: pode liberar, prazo incerto.
   - (c) Abrir uma nova rodada da Fase 0 para avaliar outra fonte: custo de pesquisa, e hoje nenhuma alternativa foi avaliada.
4. **RF-18b (PDF).**
   - (a) Spike de build + auditoria de licença do `expo-pdf-text-extract` antes de adotar: uma rodada curta, mas é uma dependência frágil (pacote jovem, mantenedor único).
   - (b) Adiar o RF-18b e manter a mensagem "PDF sem suporte, envie prints": zero risco, perde a entrada por PDF.
5. **Critério de aceite do RF-40 no Android.**
   - (a) Reescrever o critério para comportamento em runtime ("nenhum prompt de permissão de mídia") e adotar Android 13+ como alvo: alinhado ao feasibility, exige teste em device.
   - (b) Manter o critério literal do manifest: o RF-40 no Android falha com o `expo-image-picker`, e não há alternativa avaliada.
   - (c) Suportar Android ≤ 12L: as entradas de permissão passam a valer em runtime nesses aparelhos, o que contraria o objetivo "sem permissão".

CHECKPOINT: aguardando aprovação explícita do resultado da PRE-04.

---

## 8. Rodada login social (2026-09-28)

Agente: `phase0-arbiter`. Nenhuma pesquisa nova. As seções 1 a 7 acima não foram alteradas. Onde esta seção diverge delas, **esta seção prevalece**, e cada divergência aparece em 8.4.

Insumos lidos:
- `tos-report.md`: §2 (linhas P-GOOGLE-ID, P-APPLE-ID e a linha P-PLAY "Account Deletion", todas de 2026-09-28), §3 (TOS-REQ-45 a 52 e a TOS-REQ-35 reforçada), §5 (PEND-22 a 25) e §7.
- `integration-feasibility.md`: §5 (SPIKE-16), §6 (pendências 28 a 33) e §9.
- `security-threat-model.md`: §7 (F-12, T-43 a T-53, SEC-CTRL-53 a 63, SEC-REQ-34 a 43, GAP-15 a 20).
- Contexto: `platforms.md` (P-GOOGLE-ID, P-APPLE-ID, RF-41) e `decisions.md` (D-01 a D-11).

Critérios: os mesmos 1 a 10 das seções anteriores, mais dois:
11. Os SEC-CTRL-53 a 63 estão todos **propostos e não implementados**. O próprio threat model diz isso: F-12 não existe em código. Toda linha cuja ameaça Alta/Crítica depende de GAP aberto (GAP-15, 16, 18, 19) fica `BLOQUEADO`. A coluna de restrições informa o status **depois** das pré-condições da 8.2, como a 7.1 fez com C-15.
12. Quando o feasibility propõe um desenho que um SEC-REQ proíbe expressamente, prevalece o SEC-REQ, e a arbitragem vira ARB-REQ. É o mesmo tratamento dado à C-05.

### 8.1 Matriz de decisão

| Platform ID | RF | Capacidade | ToS | Viabilidade | Segurança | SC-PERSONAL | SC-STORE | Restrições/condições |
|---|---|---|---|---|---|---|---|---|
| P-GOOGLE-ID | RF-41 | Google no Android com lib nativa (`@react-native-google-signin/google-signin`, Credential Manager) e ID token validado no backend | P: PCC / S: PCC (TOS-REQ-45, 46, 47; em S também TOS-REQ-28 e 52, e PEND-22 NÃO VERIFICADO) | VIÁVEL pela doc. Exige dev build/EAS e não roda no Expo Go. O SPIKE-16 cobriu só discovery/JWKS; nenhum login real foi exercitado. Suporte a `nonce` na lib: NÃO VERIFICADO (pendência 30) | T-43 Crítica: SEC-CTRL-53/54 não implementados (**GAP-15**). T-48 Alta: SEC-CTRL-57 não implementado (**GAP-18**). T-45/T-52: SEC-CTRL-55 depende do `nonce` da lib. T-51: SEC-CTRL-63. SEC-CTRL-58: N/A (SDK nativo, sem redirect), a documentar | `BLOQUEADO` | `BLOQUEADO` | Após a 8.2: P `GO COM RESTRIÇÃO`, em modo "Testing" do Google com o seu e-mail como testador e um Client ID Android por SHA-1 de cada keystore. S também exige sair do modo Testing com verificação de marca (TOS-REQ-45, PEND-22), política de privacidade pública (TOS-REQ-28) e link web de exclusão (TOS-REQ-52). Se a lib não expuser `nonce`, ver a Decisão 5 (8.5). |
| P-GOOGLE-ID | RF-41 | Google no web com Google Identity Services (botão/One Tap) | P: PCC / S: PCC (idem) | VIÁVEL (`nonce` documentado em `initialize()`) | GAP-15 e GAP-18, como acima. T-45 Alta (login CSRF): SEC-CTRL-55 e 59 não implementados. Herda o F-11 (7.1: web `GO COM RESTRIÇÃO` só em uso local/dev; hosting NÃO AVALIADO, PND-33) | `BLOQUEADO` | `BLOQUEADO` | Após a 8.2: P `GO COM RESTRIÇÃO` no mesmo alcance do F-11 (local/dev). Qualquer deploy público herda PND-33 e SEC-CTRL-48/49. S: as condições do Android mais o hosting. |
| P-APPLE-ID | RF-41 | Apple no iOS (`expo-apple-authentication`) | P: PCC (TOS-REQ-35: conta paga; 4.8 e 5.1.1(v) N/A) / S: PCC (TOS-REQ-48 a 51), mas o texto de `/auth/revoke`/TN3194 (PEND-24) e o da HIG do botão (PEND-25) estão NÃO VERIFICADO | VCL: exige Apple Developer Program pago e dev build/EAS; o runtime iOS segue sem device real ou Mac (mesma limitação do SPIKE-14). `nonce` na lib: NÃO VERIFICADO (pendência 30). Nome/formato das claims de relay e de `email_verified`: NÃO VERIFICADO (pendência 31) | GAP-15 e GAP-18. T-44 via relay (SEC-CTRL-56, GAP-16). **T-50 Alta: SEC-CTRL-60 não implementado (GAP-19), bloqueante de submissão iOS** | `BLOQUEADO` | `BLOQUEADO` | Após a 8.2 e com a conta paga ativa: P `GO COM RESTRIÇÃO`. S continua `BLOQUEADO` até a PEND-24 (critério 5: a condição da TOS-REQ-51 não tem texto verificado), a C-26 e o SEC-CTRL-60. Resolver a PEND-25 antes do design final do botão. É obrigatória em S **se** houver Google no build iOS (TOS-REQ-48; PEND-23 AMBÍGUO; pendência 32). |
| P-APPLE-ID | RF-41 | Apple no web (Sign in with Apple JS com Services ID) | P: PCC / S: PCC (conta paga; domínio e return URL registrados) | VIÁVEL pela doc, mas exige return URL HTTPS em domínio registrado e o backend assinando o client secret (ES256) com a chave `.p8`. Sobre o arquivo de verificação de domínio, os relatórios divergem (C-23) | GAP-15 e GAP-18. T-45: `form_post` com cookie de pré-login `SameSite=Lax` (SEC-CTRL-59). Nova chave privada `.p8` no backend (SEC-CTRL-25, SEC-REQ-10). Herda F-11 e hosting | `BLOQUEADO` | `BLOQUEADO` | Depende de hosting público com domínio (PND-33), que nenhum relatório avaliou. Por isso não há `GO` nem em uso local. Só é necessária se a Apple no iOS existir e uma conta só-social da Apple precisar entrar no web (Decisões 1 e 3). |
| P-GOOGLE-ID, P-APPLE-ID | RF-41 | Vínculo **automático e silencioso** por e-mail a uma conta existente (passo 2 da §9.3 do feasibility) | P: PCC / S: PCC (o tos-report proíbe mesclar relay da Apple com e-mail real do Google só porque "parecem" o mesmo) | VIÁVEL em código, mas **inoperante hoje**: `users.email_verified` não existe e nenhuma conta tem e-mail verificado (pendência 29) | T-44 Alta. SEC-CTRL-56/SEC-REQ-36 **proíbem** merge automático e silencioso, mesmo com `email_verified=true` nas duas pontas. GAP-16 | `NO-GO` | `NO-GO` | ARB-REQ-09 (critério 12, C-25). |
| P-GOOGLE-ID, P-APPLE-ID | RF-41 | Variante: vínculo por e-mail com link de confirmação de uso único | PCC. E-mail enviado a relay da Apple exige SPF/DKIM registrados (TOS-REQ-50) | NÃO AVALIADO: não há provedor de e-mail transacional em `platforms.md`, nem fluxo de verificação de e-mail no projeto | SEC-CTRL-56 aceita esta forma. GAP-16: schema e fluxo não existem | `BLOQUEADO` | `BLOQUEADO` | Exige pôr o provedor de e-mail em `platforms.md` e passá-lo pelos três relatórios (PND-45). Ver a Decisão 2. |
| P-GOOGLE-ID, P-APPLE-ID | RF-41 | Vínculo "estando logado" (`POST /auth/social/link`, com `Authorization: Bearer`) | PCC (herda o provedor) | VIÁVEL (§9.3 do feasibility, fluxo 4, recomendado como caminho principal) | Seguro contra T-44, porque não depende de e-mail. Ainda exige SEC-CTRL-53/54/55/63 (GAP-15) e o índice único `(provider, provider_sub)`, que impede ligar a mesma identidade a outro usuário | `BLOQUEADO` | `BLOQUEADO` | Após a 8.2: `GO COM RESTRIÇÃO` onde o provedor/plataforma estiver liberado (linhas acima). Não passa pelo gate de criação (SEC-CTRL-57), porque não cria conta. |
| P-GOOGLE-ID, P-APPLE-ID | RF-41 | Conta só-social (criada por login social, sem senha) | PCC (TOS-REQ-47). Em S, pesa na leitura da 4.8: pela PEND-23, a exceção só é possível se o login social for estritamente adicional | VIÁVEL, mas exige mudança de schema (pendência 28). Os relatórios divergem sobre `password_hash` já ser nullable (C-28) | T-48 Alta: a criação precisa do gate (SEC-CTRL-57, **GAP-18**). T-53 Baixa: SEC-CTRL-62. GAP-20: a recuperação depende só do Google/Apple (risco inerente, sem controle testável) | `BLOQUEADO` | `BLOQUEADO` | Após a 8.2: `GO COM RESTRIÇÃO`, com aceite explícito seu do GAP-20 e oferta autenticada de "adicionar senha" logo após o 1º login. Em SC-PERSONAL, com `ALLOWED_EMAILS` de 1 e-mail, uma conta Apple com Hide My Email **não** passa no gate, porque o relay não está na allowlist. O fail-closed está correto, e o caminho passa a ser o vínculo "estando logado". |
| P-GOOGLE-ID, P-APPLE-ID, P-PLAY | RF-41, SC-STORE | Exclusão de conta com revogação no provedor | P: N/A pela Apple (a 5.1.1(v) só vale em review), mas a SEC-REQ-40 vale nos dois cenários / S: PCC (TOS-REQ-51, com PEND-24 NÃO VERIFICADO; TOS-REQ-52: link web + "Data safety") | Apple `/auth/revoke`: documentado, não exercitado, exige a `.p8`. Google: o feasibility não avalia revogação, e o desenho da §9.3 não obtém nenhum token revogável do Google (C-27). A estratégia da Apple diverge entre os relatórios (C-26) | T-50 Alta: SEC-CTRL-60 não implementado (**GAP-19**). A exclusão atual (SEC-CTRL-24) não conversa com provedores | `BLOQUEADO` | `BLOQUEADO` | P: desbloqueia com o SEC-CTRL-60 construído e a C-27 resolvida, antes de vincular a primeira identidade real. S: também PEND-24, C-26 e TOS-REQ-52. Para a Apple, é bloqueante de submissão. |

Fora do pedido, registrado para não reaparecer como atalho:
- **Apple no Android:** INVIÁVEL (não há SDK nativo), portanto `NO-GO` nos dois cenários. A rota Apple JS em navegador não foi recomendada e, se for usada, cai no SEC-CTRL-58 (GAP-17).
- **Google no iOS:** VIÁVEL, mas não foi pedido. Ligar o Google no build iOS **aciona** a 4.8 em SC-STORE (TOS-REQ-48, pendência 32).
- **`expo-auth-session` para Google:** viável, mas não recomendado (pendência 33). Se for usado, é fluxo por navegador e passa a exigir o SEC-CTRL-58 inteiro.

#### 8.1.1 Resumo

| Capacidade | Hoje (P / S) | Após as pré-condições da 8.2 (P / S) | O que ainda segura SC-STORE |
|---|---|---|---|
| Google Android (lib nativa) | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` / `BLOQUEADO` | TOS-REQ-45 (publicação + marca, PEND-22), TOS-REQ-28, TOS-REQ-52 |
| Google web (GIS) | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` (só local/dev) / `BLOQUEADO` | Os mesmos do Android + hosting (PND-33) |
| Apple iOS | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` (com a conta paga) / `BLOQUEADO` | PEND-24, C-26, SEC-CTRL-60 (GAP-19), PEND-25 |
| Apple web (Services ID) | `BLOQUEADO` / `BLOQUEADO` | `BLOQUEADO` / `BLOQUEADO` | Hosting com domínio (PND-33) nos dois cenários |
| Vínculo automático silencioso por e-mail | `NO-GO` / `NO-GO` | `NO-GO` / `NO-GO` | ARB-REQ-09 |
| Vínculo por link de confirmação por e-mail | `BLOQUEADO` / `BLOQUEADO` | `BLOQUEADO` / `BLOQUEADO` | Provedor de e-mail não avaliado (PND-45) |
| Vínculo "estando logado" | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` / herda o provedor | Os do provedor |
| Conta só-social | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` (com aceite do GAP-20) / `BLOQUEADO` | PEND-23 (4.8), os do provedor |
| Exclusão com revogação | `BLOQUEADO` / `BLOQUEADO` | `GO COM RESTRIÇÃO` (após a C-27) / `BLOQUEADO` | PEND-24, C-26, TOS-REQ-52 |

**Nenhuma linha é `GO` hoje.** O motivo comum é o GAP-15: não existe nenhuma linha de código de validação de ID token. O que resta depois da 8.2 em SC-PERSONAL é trabalho de engenharia já especificado. Em SC-STORE, faltam também verificações externas (PEND-22, 23, 24) e hosting.

**Impacto no produto (RF-41):** em SC-PERSONAL, nada de login social fica disponível até a 8.2 estar construída e testada. Com a recomendação da 8.5, o RF-41 vira "conectar Google a uma conta que já existe", no Android e no web local, sem criar conta por login social e sem Apple. Em SC-STORE, o RF-41 fica inteiro bloqueado. Se o Google entrar no build iOS, a Apple deixa de ser opcional.

### 8.2 Pré-condições de implementação

#### 8.2.1 Controles que precisam existir e estar testados antes de expor qualquer `POST /auth/social` (GAP-15)

"Expor" segue o texto do GAP-15: qualquer ambiente, inclusive atrás de feature flag "beta". A rota nasce desligada por flag de provedor × plataforma (ARB-REQ-12) e só é ligada quando todos os itens 1 a 9 aplicáveis a ela passarem em CI.

| Ordem | Controle | O que precisa existir | Teste que precisa passar | Ameaça |
|---|---|---|---|---|
| 1 | SEC-CTRL-53 | Validação no backend: assinatura contra o JWKS oficial, algoritmo fixo (nunca `alg=none` nem simétrico), `iss` exato, `aud` em allowlist, `exp`, `iat` recente | JWTs adversariais (assinatura errada, `iss` trocado, `aud` de outro app, `alg=none`, HS256 com a chave pública como segredo, expirado, `iat` antigo) rejeitados sem criar sessão | T-43 Crítica (GAP-15) |
| 2 | SEC-CTRL-54 | JWKS com cache e cooldown por `kid` desconhecido; falha do JWKS devolve erro controlado | N tokens com `kid` aleatório geram número limitado de fetches (mock); JWKS indisponível não derruba a rota | T-47 (GAP-15) |
| 3 | SEC-CTRL-63 | Campo `platform` explícito no payload e tabela `aud` × plataforma | Token com `aud` do client Android apresentado como `platform: 'web'` é rejeitado | T-51 (ARB-REQ-10) |
| 4 | SEC-CTRL-55 | `nonce` de uso único ligado a pré-sessão no servidor; na Apple, comparação via SHA-256 | Nonce ausente, divergente ou reutilizado é rejeitado; teste específico da Apple com SHA-256 | T-45, T-52. A plataforma cuja lib não expuser `nonce` fica desligada até a Decisão 5 |
| 5 | SEC-CTRL-57 | Gate `ALLOWED_EMAILS`/`REGISTRATION_ENABLED` em toda **criação** de conta via social | E-mail verificado fora da allowlist recebe 403 e nenhuma linha nova em `users`; é gate de CI (GAP-18) | T-48 Alta |
| 6 | SEC-CTRL-56 + ARB-REQ-09 | Nenhuma sessão por coincidência de e-mail; vínculo só pelo caminho definido na Decisão 2 | 1º login social com e-mail de conta existente não cria sessão nem linha em `identities` | T-44 Alta (GAP-16) |
| 7 | SEC-CTRL-59 (só rota web) | `Origin` contra `WEB_ORIGIN`, `X-Fruiqo-Client: web` e cookie de pré-login `SameSite=Lax`, de TTL curto, com `state`/`nonce` | Callback sem o cookie, ou com `state`/`nonce` divergente, recebe 401/403 sem linha nova em `users`/`sessions` | T-45 Alta |
| 8 | SEC-CTRL-61 | Redação de `idToken`/`identityToken`/`authorizationCode` no sanitizador de log; nenhuma coluna de foto | Teste do sanitizador; migration sem `picture` | T-49; TOS-REQ-47 |
| 9 | SEC-CTRL-62 | Resposta uniforme de login por senha para conta sem senha; "definir senha" só com sessão | Mensagem e tempo equivalentes a "e-mail inexistente"; 401 sem sessão | T-53. Obrigatório antes da 1ª linha com `password_hash` nulo |
| 10 | SEC-CTRL-58 | Documento por combinação plataforma × provedor dizendo se é SDK nativo (N/A) ou navegador | Revisão | T-46 (GAP-17). Vira obrigatório, com a suíte do SEC-CTRL-14, se qualquer combinação usar navegador (ex.: `expo-auth-session`) |

Depois da exposição, com prazo próprio:
- **SEC-CTRL-60** (revogação na exclusão, com retry idempotente): antes de vincular a primeira identidade real, porque a SEC-REQ-40 vale nos dois cenários e o GAP-19 só aceita a ausência "enquanto o login social não estiver disponível". A parte da Apple é bloqueante de submissão iOS e depende da PEND-24 e da C-26. A parte do Google depende da C-27.
- Reaproveitamento sem alteração de `createSession`/`pair()`, rotação de refresh e RLS (threat model §7, parte final do F-12). Nenhum controle novo é necessário nessa etapa.

#### 8.2.2 Mudanças de schema

| Mudança | Origem | Observação |
|---|---|---|
| `users.password_hash` passa a nullable | Feasibility, pendência 28; SEC-CTRL-62 | Os relatórios divergem sobre o estado atual (C-28). Tratar como `NOT NULL` e prever a migration. Só aplicar junto com o SEC-CTRL-62. Desnecessário se a Decisão 3 for (a) |
| `users.email_verified boolean not null default false` | Feasibility §9.3, pendência 28 | Sem fluxo de verificação de e-mail, fica `false` em todas as contas locais. Não serve de gatilho de vínculo (ARB-REQ-09) |
| Nova tabela `identities` (`provider`, `provider_sub`, `user_id` FK, `email`, `email_verified`, `created_at`), índice único `(provider, provider_sub)`, RLS FORCE | Feasibility §9.3; SEC-CTRL-61 | Sem coluna de foto. Nome só se o usuário confirmar. Removida em cascata com a conta (SEC-REQ-15). Comparação de e-mail case-insensitive (feasibility §9.3) |
| Armazenamento de `nonce`/`state` de uso único com TTL curto | SEC-CTRL-55, 59 | Os relatórios não fixam o meio (tabela ou Redis) |
| Registro/fila de revogação pendente, idempotente | SEC-CTRL-60 | Para o retry quando o provedor falhar |
| Condicional à C-26: refresh token da Apple cifrado em `identities` | TOS-REQ-51; padrão da SEC-REQ-08 | Só se a C-26 for resolvida pela opção "guardar e revogar na exclusão". Na opção "revogar logo após o login", não há coluna |
| Condicional à Decisão 2 (b): estado de "vínculo pendente" e token de confirmação de uso único | SEC-CTRL-56 | Não criar se a Decisão 2 for (a) |

#### 8.2.3 Passos manuais seus (consoles)

Nenhuma conta ou projeto foi criado em seu nome (feasibility §9). Só execute o bloco do provedor escolhido na Decisão 1.

Google Cloud Console:
1. Criar/selecionar o projeto.
2. Configurar a OAuth consent screen: tipo Externo, escopos `openid`, `email` e `profile`. Manter em "Testing" e cadastrar o seu e-mail como usuário de teste (SC-PERSONAL).
3. Criar o Client ID tipo **Web application**. Ele é o `webClientId`, usado como audience.
4. Criar o Client ID tipo **Android**, com o `applicationId` e o SHA-1 de **cada** keystore: debug local, o gerenciado pelo EAS (`eas credentials`) e, quando existir, o de produção.
5. Não criar o Client ID iOS enquanto a Decisão 4 não liberar o Google no iOS.
6. Guardar os IDs em variáveis de ambiente (`GOOGLE_WEB_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`), nunca versionadas (SEC-REQ-10).
7. Antes de SC-STORE: publicar política de privacidade e homepage em domínio verificado, sair do modo Testing e passar pela verificação de marca (TOS-REQ-28, 45). Nesse momento, confirmar a PEND-22 no próprio console.

Apple Developer (só se a Apple entrar):
1. Assinatura ativa do Apple Developer Program, cerca de US$ 99/ano (TOS-REQ-35).
2. Habilitar "Sign in with Apple" no App ID.
3. Para o web: criar um Services ID (ex.: `com.fruiqo.web.signin`) associado ao App ID e cadastrar domínio e return URL HTTPS. Isso exige hosting (PND-33). Seguir o que o portal pedir sobre o arquivo de verificação de domínio (C-23).
4. Criar a chave "Sign in with Apple" (`.p8`, download único) e guardá-la só no backend (SEC-CTRL-25, SEC-REQ-10).
5. Anotar Team ID, Key ID e o identificador do Services ID.
6. Confirmar a capability no provisioning profile gerado pelo EAS Build.
7. Se for enviar e-mail a usuários com Hide My Email: registrar os domínios de envio com SPF/DKIM (TOS-REQ-50).

Google Play Console (só em SC-STORE): declarar no "Data safety" o link web público de exclusão de conta (TOS-REQ-52).

### 8.3 Requisitos herdados novos

#### 8.3.1 Obrigações de ToS (`tos-report.md` §3)

| ID | Requisito (resumo) | Origem | Escopo | Atendido no código? |
|---|---|---|---|---|
| TOS-REQ-45 | Sair do modo "Testing" e concluir a verificação de marca antes de operar com N usuários reais | P-GOOGLE-ID | SC-STORE (SC-PERSONAL opera em Testing) | Não (PEND-22) |
| TOS-REQ-46 | Botão "Sign in with Google" conforme as branding guidelines, com o mesmo destaque dos outros logins | P-GOOGLE-ID | Ambos | Não existe UI |
| TOS-REQ-47 | "Limited Use": só para autenticação/conta; sem venda, transferência ou publicidade; foto só se exibida | P-GOOGLE-ID | Ambos | Não (coberto pelo SEC-CTRL-61) |
| TOS-REQ-48 | Com Google no iOS, oferecer também Sign in with Apple antes de qualquer review (TestFlight externo ou App Store) | P-APPLE-ID | SC-STORE | Não (PEND-23 AMBÍGUO; Decisão 4) |
| TOS-REQ-49 | Botão da Apple só com o artwork oficial, altura mínima de 44pt e o mesmo destaque do Google | P-APPLE-ID | Ambos | Não (PEND-25) |
| TOS-REQ-50 | Aceitar e persistir e-mails de relay (`@privaterelay.appleid.com`, `@private.icloud.com`); SPF/DKIM se enviar e-mail | P-APPLE-ID | Ambos | Não |
| TOS-REQ-51 | Chamar `/auth/revoke` da Apple no `DELETE /account`; refresh token da Apple só no backend | P-APPLE-ID | SC-STORE (recomendado em ambos pela SEC-REQ-40) | Não (PEND-24, C-26) |
| TOS-REQ-52 | Link web público de exclusão de conta, sem exigir o app, declarado no "Data safety" | P-PLAY | SC-STORE | Não |

Reforçadas nesta rodada: **TOS-REQ-35** (conta paga da Apple também para Sign in with Apple e Services ID) e **TOS-REQ-28** (a mesma política de privacidade precisa cobrir os dados de login social).

#### 8.3.2 Requisitos de segurança (`security-threat-model.md` §7.4)

| ID | Requisito (resumo) | Controle | Estado no código |
|---|---|---|---|
| SEC-REQ-34 | ID token validado no backend (JWKS, `iss`, `aud` por plataforma, `exp`, `iat` recente) antes de qualquer criação ou vínculo | SEC-CTRL-53, 54 | **Não implementado** (GAP-15) |
| SEC-REQ-35 | `nonce` de uso único ligado à pré-sessão do servidor, obrigatório | SEC-CTRL-55 | **Não implementado**; nativo depende da pendência 30 |
| SEC-REQ-36 | Vínculo por e-mail só com `email_verified=true` **e** confirmação explícita; nunca merge silencioso | SEC-CTRL-56 | **Não implementado** (GAP-16) |
| SEC-REQ-37 | Gate `ALLOWED_EMAILS`/`REGISTRATION_ENABLED` também na criação via social | SEC-CTRL-57 | **Não implementado** (GAP-18) |
| SEC-REQ-38 | Fluxo por redirect/WebView segue PKCE, `state` e App/Universal Links (SEC-REQ-07) | SEC-CTRL-58 | Condicional (GAP-17) |
| SEC-REQ-39 | `POST /auth/social` no web com as 3 camadas anti-CSRF e o cookie de pré-login | SEC-CTRL-59 | **Não implementado** |
| SEC-REQ-40 | Exclusão com identidade vinculada revoga no provedor, com retry idempotente | SEC-CTRL-60 | **Não implementado** (GAP-19; C-26, C-27) |
| SEC-REQ-41 | Perfil social mínimo (`sub`, `email`, `email_verified`, nome confirmado); sem foto; tokens redigidos em log | SEC-CTRL-61 | **Não implementado** |
| SEC-REQ-42 | Conta só-social indistinguível de "e-mail inexistente"; "adicionar senha" só autenticado | SEC-CTRL-62 | **Não implementado** |
| SEC-REQ-43 | `aud` validado contra a plataforma declarada no payload | SEC-CTRL-63 | **Não implementado** |

GAP-20 (recuperação de conta só-social) não tem controle testável. Só pode ser aceito por você, se a Decisão 3 for (b).

#### 8.3.3 Restrições derivadas desta arbitragem

| ID | Restrição | Motivo |
|---|---|---|
| ARB-REQ-09 | Nenhum vínculo automático e silencioso por e-mail, nem com `email_verified=true` nas duas pontas. O passo 2 da resolução de identidade da §9.3 do feasibility é removido. Ordem válida: (1) `(provider, sub)` já vinculado leva à sessão; (2) e-mail coincide com conta existente não gera sessão, e o usuário é orientado a entrar pelo método atual e vincular "estando logado"; (3) sem conta com esse e-mail, só cria conta se a Decisão 3 permitir **e** o gate SEC-CTRL-57 passar. | SEC-REQ-36; C-25, C-31 |
| ARB-REQ-10 | O payload de `POST /auth/social` é `{ provider, platform, idToken, nonce, deviceName }`, com `platform` explícito e nunca inferido. | SEC-CTRL-55, 63; C-24 |
| ARB-REQ-11 | A criação de conta via social passa pelo mesmo gate do `/auth/register`, com o mesmo erro. Em SC-PERSONAL, e-mail de relay da Apple fora da allowlist é recusado, e o caminho é o vínculo "estando logado". | SEC-REQ-37; C-29 |
| ARB-REQ-12 | Feature flag por provedor × plataforma, desligada por padrão. Só liga quando os itens da 8.2.1 aplicáveis à rota passarem em CI. O Google fica desligado no build iOS enquanto a Apple não estiver pronta. O build SC-STORE segue a ARB-REQ-05. | GAP-15, 18; TOS-REQ-48 |
| ARB-REQ-13 | A chave de identidade é `(provider, sub)`. O e-mail (e o relay da Apple, em especial) nunca é chave de vínculo entre provedores. | Tos-report (linha P-APPLE-ID "Vínculo de conta por e-mail"); T-44 |

### 8.4 Contradições e pendências novas

#### 8.4.1 Contradições

| ID | Contradição | Arbitragem | Dono sugerido |
|---|---|---|---|
| C-23 | O tos-report (linha P-APPLE-ID do Services ID) cita o arquivo de verificação em `/.well-known/apple-developer-domain-association.txt`. O feasibility (§9.2, passo 4 da Apple) diz "sem necessidade de upload de arquivo de verificação". | Não assumir a dispensa: seguir o que o portal da Apple exigir na configuração. Sem efeito no status, que já é `BLOQUEADO` por hosting. | Você (ao configurar o Services ID) |
| C-24 | O feasibility (§9.3) define o payload como `{ provider, idToken, deviceName }`. O threat model (F-12) exige `nonce` e `platform` explícitos (SEC-CTRL-55, 63). | Prevalece o threat model (ARB-REQ-10). | Você (spec) |
| C-25 | O feasibility (§9.3, passo 2) propõe vínculo automático quando as duas pontas têm e-mail verificado. O threat model (SEC-CTRL-56, SEC-REQ-36) proíbe merge automático e silencioso mesmo nesse caso. | Critério 12: `NO-GO` (ARB-REQ-09). | Você |
| C-26 | Revogação da Apple: o feasibility propõe trocar o `authorizationCode` e revogar logo após o login, sem persistir token. A TOS-REQ-51 manda guardar o refresh token no backend e revogar no `DELETE /account`. O SEC-CTRL-60 revoga na exclusão. O trecho verbatim da 5.1.1(v) citado no tos-report diz "may not store credentials or tokens to social networks off of the device". Nenhum relatório confirma que revogar logo após o login satisfaz a 5.1.1(v)/TN3194. | Aberto. A Apple em SC-STORE fica `BLOQUEADO` até a PEND-24, com leitura verbatim da TN3194 e do endpoint. | Você (reexecutar o auditor com leitura direta) + parecer jurídico, se a opção for persistir |
| C-27 | O SEC-CTRL-60 prevê `POST https://oauth2.googleapis.com/revoke` "com o token da identidade". O desenho do feasibility (§9.3) só recebe o ID token do Google, sem access/refresh token, e o feasibility não avalia a revogação no Google. | O SEC-CTRL-60 fica sem mecanismo definido para o Google. O mínimo verificável é excluir a conta e a linha de `identities`. O que o Google exige além disso não está nos relatórios. | Você (reexecutar o feasibility scout e o auditor) |
| C-28 | O threat model (SEC-CTRL-62) diz que `password_hash` é "coluna já nullable no schema atual". O feasibility (pendência 28) diz que ela é `NOT NULL` em `apps/api/src/db/schema.ts`. | Fail-closed: tratar como `NOT NULL` e prever a migration. Confirmar no arquivo. | Você |
| C-29 | A §9.3 do feasibility cria conta só-social quando não há conta com o e-mail, sem citar o gate `ALLOWED_EMAILS`/`REGISTRATION_ENABLED`. A SEC-REQ-37 exige o gate. | Prevalece a SEC-REQ-37 (ARB-REQ-11). | Você (spec) |
| C-30 | O SPIKE-16 (GET em discovery/JWKS do Google e da Apple) rodou na mesma rodada em que o auditor classificou P-GOOGLE-ID e P-APPLE-ID, e a ordem não foi registrada (mesmo padrão da C-21). | Sem efeito: endpoints públicos documentados, sem credencial, e as duas plataformas ficaram PCC. Nenhum corpo bruto foi gravado. | Você |
| C-31 | Para conta local não verificada com o mesmo e-mail, a §9.3 do feasibility admite "criar uma conta social separada e sinalizar o conflito". O SEC-CTRL-56 prevê estado de "vínculo pendente" e não prevê conta duplicada. | Não criar conta duplicada com o mesmo e-mail. Responder com orientação para entrar pelo método atual e vincular "estando logado" (ARB-REQ-09). Revelar a existência da conta só a quem provou ser dono do e-mail no provedor; o login por senha continua sob o SEC-CTRL-62. | Você (spec) |

#### 8.4.2 Pendências

| ID | Pendência | Bloqueia | Dono sugerido |
|---|---|---|---|
| PND-37 | PEND-22: saber se escopos básicos pedem só verificação de marca ao publicar | Google em SC-STORE | Você (Google Cloud Console) |
| PND-38 | PEND-23: se a 4.8 obriga a Apple, dado o desenho final de autenticação | Apple em SC-STORE; Decisões 3 e 4 | Você (decisão) + parecer jurídico, se for depender da exceção |
| PND-39 | PEND-24: texto verbatim de `/auth/revoke` e da TN3194 | Apple em SC-STORE; C-26 | Você (reexecutar o auditor com leitura direta) |
| PND-40 | PEND-25: texto verbatim da HIG do botão da Apple | UI da Apple | Você (reexecutar o auditor) |
| PND-41 | Pendência 30: `nonce` em `@react-native-google-signin/google-signin` e em `expo-apple-authentication` | Google Android, Apple iOS (SEC-CTRL-55) | Você (reexecutar o feasibility scout, leitura da API dos pacotes) |
| PND-42 | Pendência 31: nome e formato das claims de relay e de `email_verified` no token da Apple | Parser da Apple | Você (reexecutar o feasibility scout) |
| PND-43 | Pendência 28 + C-28: estado real de `password_hash` e plano de migration | Conta só-social | Você |
| PND-44 | C-27: revogação no Google sem token revogável no desenho atual | SEC-CTRL-60 (Google) | Você (feasibility scout + auditor) |
| PND-45 | Provedor de e-mail transacional: entrada em `platforms.md` e passagem pelos três relatórios | Variante de vínculo por link; e-mail a relay (TOS-REQ-50) | Você (só se a Decisão 2 for (b)) |
| PND-46 | Construir e testar os SEC-CTRL-53 a 63 na ordem da 8.2.1 | Todo o RF-41 | Você (Fase 1) |
| PND-47 | Teste em device: login Google num dev build Android (SHA-1 correto) e, se a Apple entrar, login Apple num iPhone real | Confirmação prática do `GO COM RESTRIÇÃO` | Teste em device |
| PND-48 | Aceite formal do GAP-20 (recuperação de conta só-social) | Conta só-social | Você (só se a Decisão 3 for (b)) |

### 8.5 Decisões que preciso tomar

1. **Provedores nesta fase.**
   - (a) Só Google (Android com lib nativa + web GIS): não tem custo novo e não aciona a 4.8 enquanto o Google ficar fora do build iOS. O RF-41 fica sem Apple.
   - (b) Google + Apple (iOS + web): cobre a 4.8 desde já, mas exige a conta paga, a `.p8`, hosting com domínio para o Services ID e a revogação (C-26, PEND-24) antes da loja.
   - (c) Adiar o RF-41 inteiro: zero risco novo, e a Fase 1 segue só com e-mail/senha.
   - **Recomendação: (a).** É a única opção que chega a `GO COM RESTRIÇÃO` em SC-PERSONAL só com engenharia já especificada.
2. **Vínculo com conta existente** (o silencioso por e-mail é `NO-GO` e não entra como opção).
   - (a) Só "estando logado" (`POST /auth/social/link`): seguro contra T-44 sem depender de e-mail, mas quem tem conta precisa entrar com senha uma vez.
   - (b) Também por link de confirmação por e-mail: menos atrito, mas exige um provedor de e-mail ainda não avaliado (PND-45) e mais schema.
   - **Recomendação: (a).**
3. **Conta só-social (sem senha).**
   - (a) Não permitir agora: o login social é só um método adicional de conta que já existe. Dispensa `password_hash` nullable, SEC-CTRL-62 e GAP-20, e mantém viva, sem garantir, a exceção da PEND-23. Porém, ninguém cria conta pelo Google.
   - (b) Permitir, com gate SEC-CTRL-57, SEC-CTRL-62 e oferta de "adicionar senha": onboarding melhor para SC-STORE, mas exige o seu aceite do GAP-20 e reforça a obrigação da 4.8.
   - **Recomendação: (a) em SC-PERSONAL.** Com 1 usuário que já tem senha, a criação via social não traz ganho. Reavaliar antes de SC-STORE.
4. **Login social no iOS / quando entra a Apple.**
   - (a) O build iOS segue sem nenhum login social por enquanto (Google desligado por flag no iOS, ARB-REQ-12), e a Apple entra junto com o Google no iOS, antes de qualquer review: sem custo agora e sem risco de 4.8, mas o iOS fica só com senha.
   - (b) Apple no iOS já nesta fase: adianta a 4.8, mas depende da conta paga e de runtime iOS que ainda não foi testado em device (SPIKE-14 só no Simulator).
   - (c) Google no iOS sem Apple: fica `NO-GO` em SC-STORE pela TOS-REQ-48 e só seria aceitável em SC-PERSONAL, gerando retrabalho.
   - **Recomendação: (a).**
5. **Se a lib nativa não expuser `nonce` (PND-41).**
   - (a) Manter a plataforma desligada até existir `nonce`: fail-closed pleno, mas pode deixar o Android sem login social por tempo indefinido.
   - (b) Aceitar formalmente, só em SC-PERSONAL, a validação sem `nonce` no nativo, compensada por `iat` curto e `aud` × plataforma (SEC-CTRL-53, 63): destrava o Android. É um aceite de risco seu sobre T-52, e não vale para SC-STORE.
   - (c) Usar `expo-auth-session` (navegador, PKCE + `state`): tem proteção anti-replay, mas contraria a recomendação da Expo (pendência 33) e passa a exigir o SEC-CTRL-58 inteiro.
   - **Recomendação: primeiro verificar a PND-41, que é barata. Se não houver `nonce`, (a) para SC-STORE e (b) para SC-PERSONAL, registrado como decisão sua.**

CHECKPOINT: aguardando aprovação explícita do resultado da rodada de login social.
