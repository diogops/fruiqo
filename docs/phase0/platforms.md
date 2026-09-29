# Escopo da Fase 0: plataformas e capacidades a validar

Fonte única de verdade para os agentes da Fase 0. Nenhum agente deve avaliar plataformas fora desta lista sem registrar isso como "fora de escopo — sugerido".

## Cenários de uso (avaliar SEMPRE os dois)

| ID | Cenário | Descrição |
|---|---|---|
| SC-PERSONAL | Uso pessoal | App instalado só nos meus devices (sideload / TestFlight interno), 1 usuário |
| SC-STORE | Publicação | App distribuído na App Store e Google Play, N usuários |

## Plataformas

| ID | Plataforma | Categoria | Capacidades pretendidas (RF) |
|---|---|---|---|
| P-IG | Instagram (Meta) | Fonte de conteúdo | RF-01, RF-03: receber link/post via share e extrair texto, caption e imagens |
| P-YT | YouTube | Fonte + streaming | RF-03 (fonte), RF-15 (deep link) |
| P-TT | TikTok | Fonte de conteúdo | RF-01, RF-03 (opcional, avaliar se barato) |
| P-SPOT | Spotify | Streaming música | RF-05 (busca), RF-15 (playlist, playback, deep link), RF-35/RF-39 (busca e recomendações para descoberta musical; verificar se o endpoint de recomendações ainda está disponível para apps novos) |
| P-AM | Apple Music | Streaming música | RF-05, RF-15 |
| P-YTM | YouTube Music | Streaming música | RF-15 |
| P-DZ | Deezer | Streaming música | RF-15 |
| P-NFLX | Netflix | Streaming vídeo | RF-15 (deep link, watchlist se existir) |
| P-PRIME | Prime Video | Streaming vídeo | RF-15 |
| P-DSNY | Disney+ | Streaming vídeo | RF-15 |
| P-MAX | Max | Streaming vídeo | RF-15 |
| P-GLOBO | Globoplay | Streaming vídeo | RF-15 |
| P-ATV | Apple TV+ | Streaming vídeo | RF-15 |
| P-TMDB | TMDB | Metadados | RF-05, RF-06 (títulos, gêneros, watch providers BR), RF-32/RF-35/RF-38/RF-39 (discover, keywords, recommendations/similar e watch providers BR usados no ranking de recomendação, sem envio ao LLM) |
| P-MB | MusicBrainz | Metadados | RF-05 (resolução de música) |
| P-JW | JustWatch | Metadados | RF-06 (disponibilidade por região) |
| P-LLM | Anthropic API | Processamento | RF-03, RF-04 (extração e detecção via LLM), RF-32 (tagging de subgênero só com título/ano), RF-33/RF-39 (interpretação da intenção de humor a partir do texto do próprio usuário, D-06) |
| P-MLKIT | Google ML Kit / Apple Vision | OCR on-device | RF-03 |
| P-APPSTORE | Apple App Store Review Guidelines | Distribuição | SC-STORE |
| P-PLAY | Google Play Developer Policy | Distribuição | SC-STORE |
| P-LGPD | LGPD / ANPD | Regulatório | RNF-03 |
| P-EXPO | Expo SDK + EAS Build | Stack mobile | RF-01, RF-15: Share Extension (iOS), intent ACTION_SEND/SEND_MULTIPLE (Android), deep links de saída, armazenamento seguro de tokens |
| P-SHARE-PLUGIN | Config plugin de share intent para Expo (candidato `expo-share-intent`) | Stack mobile | RF-01: recebimento de URL, texto, imagem e PDF via share sheet |
| P-APPLE-DEV | Apple Developer Program | Distribuição | SC-PERSONAL e SC-STORE: requisitos para TestFlight, App Groups e Share Extension |
| P-WEBSHARE | Web Share Target API (PWA) | Alternativa descartada | RF-01: confirmar o suporte atual em iOS/Safari e Android/Chrome |
| P-IOS-SHORTCUTS | Atalhos do iOS (Shortcuts) | Alternativa de contingência | RF-01: atalho no share sheet que faz POST da URL para a API (somente SC-PERSONAL) |
| P-GOOGLE-ID | Google Identity (Sign in with Google / OAuth 2.0 OIDC) | Autenticação | RF-41 (novo): login social no app Android e no web, com vínculo à conta por e-mail verificado |
| P-APPLE-ID | Sign in with Apple | Autenticação | RF-41 (novo): login social no iOS e no web; obrigatório no iOS se houver outro login social (App Store 4.8) |
| P-OPENLIBRARY | Open Library (Internet Archive) | Metadados de livros | RF-48 (novo): busca/resolução de livros (título, autor, ano, capa, assuntos), fonte primária |
| P-GOOGLEBOOKS | Google Books API | Metadados de livros | RF-48 (novo): fallback de busca de livros, com branding obrigatório |

## Pastas de saída

| Agente | Arquivo |
|---|---|
| tos-compliance-auditor | `docs/phase0/tos-report.md` |
| security-threat-modeler | `docs/phase0/security-threat-model.md` |
| integration-feasibility-scout | `docs/phase0/integration-feasibility.md` |
| phase0-arbiter | `docs/phase0/decision-matrix.md` |
