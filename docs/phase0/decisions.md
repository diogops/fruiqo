# Decisões do checkpoint da Fase 0

Decisões tomadas pelo dono do produto em 2026-09-27 sobre a seção 6 de `decision-matrix.md`.

| # | Tema | Opção escolhida | Consequência |
|---|---|---|---|
| D-01 | Cenário da Fase 1 | **1b**: SC-PERSONAL agora, com a arquitetura preparada para SC-STORE | Multi-tenancy, isolamento por usuário (RLS), feature flags e os SEC-REQ-16/21 entram desde o início, mesmo com 1 usuário |
| D-02 | Monetização | **2a**: gratuito, sem monetização | TMDB, MusicBrainz (só core/CC0) e Apple Music ficam no regime atual; Deezer continua NO-GO em SC-STORE |
| D-03 | Stack de share (RF-01) | **3b**: Expo + `expo-share-intent`, com spike paralelo de `expo-share-extension` | A aprovação da stack depende do teste da Share Extension iOS (macOS/Linux ou EAS Build) e de a análise de ToS de P-EXPO, P-SHARE-PLUGIN e P-APPLE-DEV não achar impedimento |
| D-04 | LLM × LGPD (PEND-10) | **4b**: iniciar com dados sintéticos/sem PII; conteúdo real só após resolver PEND-10 | O pipeline de LLM pode ser construído, mas conteúdo real compartilhado não vai para a Anthropic até PEND-10 fechar |
| D-05 | Escopo RF-15 no MVP | **5a**: Spotify (busca + deep link; playlist só na allowlist de até 5 usuários) + Apple Music iOS; vídeo só como "disponível em" via TMDB watch providers | Deep links para as plataformas de vídeo ficam fora do MVP |

## Ainda em aberto antes da Fase 1
- Teste em device do share sheet de IG/YT/TT (§4.1 de `integration-feasibility.md`)
- ~~Build EAS de iOS Simulator do SPIKE-12~~: feito (SPIKE-14). Share Extension, regras de ativação e App Group confirmados no artefato. Falta o teste em runtime num iPhone real (exige conta Apple paga) ou num Mac com Simulador
- ~~Spike de `expo-share-extension`~~: feito (SPIKE-13). É só iOS, não declara suporte ao SDK 57 e tem crash aberto nessa versão (#121). Descartado como substituto
- ~~Análise de ToS de P-EXPO, P-SHARE-PLUGIN, P-APPLE-DEV (C-09 da matriz)~~: feita. Nenhum impedimento; tudo PERMITIDO COM CONDIÇÃO
- PEND-10 (mecanismo de transferência internacional com a Anthropic)
