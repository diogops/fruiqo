# Decisões do checkpoint da Fase 0

Decisões tomadas pelo dono do produto em 2026-09-27 sobre a seção 6 de `decision-matrix.md`.

| # | Tema | Opção escolhida | Consequência |
|---|---|---|---|
| D-01 | Cenário da Fase 1 | **1b**: SC-PERSONAL agora, com a arquitetura preparada para SC-STORE | Multi-tenancy, isolamento por usuário (RLS), feature flags e os SEC-REQ-16/21 entram desde o início, mesmo com 1 usuário |
| D-02 | Monetização | **2a**: gratuito, sem monetização | TMDB, MusicBrainz (só core/CC0) e Apple Music ficam no regime atual; Deezer continua NO-GO em SC-STORE |
| D-03 | Stack de share (RF-01) | **3b**: Expo + `expo-share-intent`, com spike paralelo de `expo-share-extension` | A aprovação da stack depende do teste da Share Extension iOS (macOS/Linux ou EAS Build) e de a análise de ToS de P-EXPO, P-SHARE-PLUGIN e P-APPLE-DEV não achar impedimento |
| D-04 | LLM × LGPD (PEND-10) | **4b**: iniciar com dados sintéticos/sem PII; conteúdo real só após resolver PEND-10 | O pipeline de LLM pode ser construído, mas conteúdo real compartilhado não vai para a Anthropic até PEND-10 fechar |
| D-05 | Escopo RF-15 no MVP | **5a**: Spotify (busca + deep link; playlist só na allowlist de até 5 usuários) + Apple Music iOS; vídeo só como "disponível em" via TMDB watch providers | Deep links para as plataformas de vídeo ficam fora do MVP |
| D-06 | IA de recomendação por humor/gosto (2026-09-28) | **Aceite de risco em SC-PERSONAL**: o dono do produto, único usuário, aceita enviar à Anthropic o texto que ele mesmo digita (humor/pedido) e um resumo do próprio gosto | Vale só para SC-PERSONAL e só para texto digitado pelo próprio usuário; conteúdo de prints/links de terceiros continua sob a D-04. A IA só traduz o pedido em critérios estruturados (gêneros, tom, duração) validados por schema; ela **não recebe metadados do TMDB** (ARB-REQ-02/PEND-03), e o ranqueamento é feito localmente. Desligada por padrão (`AI_MODE`); sem chave, roda o modo por regras locais. SC-STORE continua exigindo resolver a PEND-10 |
| D-07 | TMDB em app com IA (C-15, PRE-04) | **(c)**: manter o TMDB e **deixar toda IA desligada** (extração por LLM, tag de subgênero L e "Como estou" com LLM) até resposta escrita do TMDB; enviar consulta ao TMDB | O backend recusa subir com TMDB ativo + qualquer IA ligada, salvo `TMDB_AI_CLEARANCE=confirmed` (definido só após a resposta do TMDB). O modo `rules` do "Como estou" continua, sem LLM |
| D-08 | "Como estou" com dado real (T-39/T-40) | **(a)**: construir SEC-CTRL-50 (opt-in "lembrar meu humor" + purga automática em 90 dias) e SEC-CTRL-51 (consentimento individual para IA) antes de usar com texto real | ARB-REQ-08 cumprida quando os dois controles estiverem no ar |
| D-09 | Descoberta de música (RF-35/39) | **(a)**: música só a partir do catálogo do usuário (ARB-REQ-07) | Spotify recommendations/related-artists = NO-GO; `/search` como insumo de ranking fica bloqueado (PEND-19) |
| D-10 | PDF (RF-18b) | **(b)**: adiar; manter "PDF sem suporte, envie prints" | Reavaliar `expo-pdf-text-extract` quando amadurecer |
| D-11 | Critério do RF-40 no Android | **(a)**: critério por comportamento em runtime ("nenhum pedido de permissão de mídia ao usuário"), alvo Android 13+ | `blockedPermissions` já remove as permissões de armazenamento do APK (verificado via `dumpsys package`) |
| D-12 | Provedores de login social (RF-41, rodada 2026-09-28) | **(a)**: só Google (Android com `@react-native-google-signin` + web com GIS) | Apple adiada; sem custo novo; a guideline 4.8 não é acionada enquanto o Google ficar fora do build iOS |
| D-13 | Vínculo com conta existente | **(a)**: só "estando logado" (`POST /auth/social/link`) | Vínculo silencioso por e-mail = NO-GO (ARB-REQ-09) |
| D-14 | Conta só-social (sem senha) | **(a)**: não permitir em SC-PERSONAL; o Google é método adicional de uma conta que já tem senha | Reavaliar antes de SC-STORE (GAP-20, PEND-23) |
| D-15 | Login social no iOS | **(a)**: iOS segue só com senha; Apple e Google entram juntos no iOS antes de qualquer review | Google desligado por flag no iOS (ARB-REQ-12) |
| D-16 | `nonce` na lib nativa do Android (PND-41) | Verificar a PND-41 primeiro; se não houver `nonce`: **(b)** aceite de risco só em SC-PERSONAL (validação com `iat` curto + `aud` × plataforma) e **(a)** plataforma desligada para SC-STORE | Aceite registrado como decisão do dono do produto; não vale para SC-STORE |
| D-17 | C-15 em SC-PERSONAL com evidência pública (2026-09-28) | Considerar a C-15 **resolvida para uso pessoal e não comercial**, com base na resposta de Travis Bell (fundador/staff do TMDB, 2024-04-18) aprovando app gratuito de recomendação com LLM + RAG sobre dados do TMDB (evidência em `docs/phase0/tmdb-consulta-C15.md`) | `TMDB_AI_CLEARANCE=confirmed` **só no ambiente pessoal local**; ARB-REQ-06 continua (nenhum dado TMDB/Spotify ao LLM); IA real ainda depende da chave Anthropic (PRE-02) e do consentimento individual (SEC-CTRL-51). **SC-STORE e o deploy no Railway seguem `pending`** até a resposta escrita do TMDB, que continua recomendada |
## Ainda em aberto antes da Fase 1
- Teste em device do share sheet de IG/YT/TT (§4.1 de `integration-feasibility.md`)
- ~~Build EAS de iOS Simulator do SPIKE-12~~: feito (SPIKE-14). Share Extension, regras de ativação e App Group confirmados no artefato. Falta o teste em runtime num iPhone real (exige conta Apple paga) ou num Mac com Simulador
- ~~Spike de `expo-share-extension`~~: feito (SPIKE-13). É só iOS, não declara suporte ao SDK 57 e tem crash aberto nessa versão (#121). Descartado como substituto
- ~~Análise de ToS de P-EXPO, P-SHARE-PLUGIN, P-APPLE-DEV (C-09 da matriz)~~: feita. Nenhum impedimento; tudo PERMITIDO COM CONDIÇÃO
- PEND-10 (mecanismo de transferência internacional com a Anthropic)
