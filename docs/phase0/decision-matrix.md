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
