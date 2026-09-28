# Tarefa: incluir validação da stack mobile na Fase 0

## Contexto
A stack candidata do projeto é:

| Camada | Escolha candidata |
|---|---|
| App mobile | Expo (React Native) + Expo Router + TypeScript |
| Share Extension / intent | Config plugin da comunidade (candidato: `expo-share-intent`) |
| Backend | NestJS no Railway (`api` + `worker`) |
| Fila | BullMQ + Redis |
| Banco | Postgres |
| Arquivos | Bucket S3-compatible (AWS S3 ou DigitalOcean Spaces) |
| OCR/LLM | Anthropic API, somente no backend |
| Push | Expo Notifications (APNs/FCM) |

PWA foi descartado como app principal porque a Web Share Target API não é suportada no iOS e o share a partir do Instagram é o requisito central (RF-01). Essa premissa também deve ser confirmada na validação.

A stack **ainda não está aprovada**. Ela depende do resultado da Fase 0.

## O que fazer

### 1. Alterações cirúrgicas em `docs/phase0/platforms.md`
Não reescreva o arquivo. Apenas **adicione** as linhas abaixo na tabela de plataformas, mantendo o formato existente:

| ID | Plataforma | Categoria | Capacidades pretendidas (RF) |
|---|---|---|---|
| P-EXPO | Expo SDK + EAS Build | Stack mobile | RF-01, RF-15: Share Extension (iOS), intent ACTION_SEND/SEND_MULTIPLE (Android), deep links de saída, armazenamento seguro de tokens |
| P-SHARE-PLUGIN | Config plugin de share intent para Expo (candidato `expo-share-intent`) | Stack mobile | RF-01: recebimento de URL, texto, imagem e PDF via share sheet |
| P-APPLE-DEV | Apple Developer Program | Distribuição | SC-PERSONAL e SC-STORE: requisitos para TestFlight, App Groups e Share Extension |
| P-WEBSHARE | Web Share Target API (PWA) | Alternativa descartada | RF-01: confirmar o suporte atual em iOS/Safari e Android/Chrome |
| P-IOS-SHORTCUTS | Atalhos do iOS (Shortcuts) | Alternativa de contingência | RF-01: atalho no share sheet que faz POST da URL para a API (somente SC-PERSONAL) |

### 2. Alteração cirúrgica em `.claude/agents/integration-feasibility-scout.md`
Adicione uma nova seção **"Validação da stack mobile"** logo antes de `## Spikes (Bash)`, com este conteúdo:

```markdown
## Validação da stack mobile
Para P-EXPO, P-SHARE-PLUGIN, P-APPLE-DEV, P-WEBSHARE e P-IOS-SHORTCUTS, responda:

| Pergunta | Evidência exigida |
|---|---|
| O plugin de share intent candidato suporta a versão atual do Expo SDK? Qual a última release, frequência de manutenção e issues abertas críticas? | Repositório oficial do plugin (releases, changelog, issues) |
| O plugin cobre URL, texto, imagem, múltiplas imagens e PDF, em iOS e Android? | README/docs do plugin |
| Quais são as limitações de memória e tempo de execução de uma Share Extension no iOS, e o plugin repassa o conteúdo ao app principal (App Groups) ou processa na extension? | Documentação Apple + docs do plugin |
| Exige dev build/prebuild? Funciona com EAS Build? Há conflito com Expo Router ou com a New Architecture? | Docs Expo + docs do plugin |
| Existe alternativa mantida caso o plugin candidato seja inviável? | Repositórios/docs oficiais |
| Quais requisitos do Apple Developer Program valem para TestFlight interno com Share Extension (conta paga, App Groups, provisioning)? | developer.apple.com |
| Qual o estado atual do suporte à Web Share Target API em Safari/iOS e Chrome/Android? | web.dev, MDN, WebKit status/bugzilla |
| Um Atalho do iOS consegue aparecer no share sheet do Instagram, receber a URL e fazer POST autenticado para uma API? | Documentação Apple de Shortcuts + teste em device |
| O que o app do Instagram (e TikTok/YouTube) realmente entrega ao share sheet: só URL, texto + URL, imagem? Em iOS e em Android? | Marcar `VALIDAR EM DEVICE` e gerar roteiro de teste |

Registre os resultados nas seções 1 e 2 do relatório com os mesmos status (`VIÁVEL`, `VIÁVEL COM LIMITAÇÃO`, `INVIÁVEL`, `NÃO VERIFICADO`, `VALIDAR EM DEVICE`).

Adicione ao relatório a seção **"7. Veredito da stack mobile"**:
| Opção | RF-01 iOS | RF-01 Android | Riscos | Veredito |
|---|---|---|---|---|
| Expo + plugin candidato | | | | |
| Expo + alternativa | | | | |
| PWA + Atalho iOS (só SC-PERSONAL) | | | | |

Spike opcional permitido: criar um projeto Expo mínimo em `docs/phase0/spikes/expo-share/` apenas com o plugin configurado, para verificar se `npx expo prebuild` gera a Share Extension (iOS) e o intent-filter (Android). Não fazer build assinado, não usar credenciais Apple e não publicar nada.
```

### 3. Execução
1. Mostre o diff das duas alterações e **aguarde minha aprovação** antes de salvar.
2. Após aprovado, execute **somente** o subagente `integration-feasibility-scout`, com foco nas plataformas novas (P-EXPO, P-SHARE-PLUGIN, P-APPLE-DEV, P-WEBSHARE, P-IOS-SHORTCUTS e o comportamento de share de P-IG).
3. Ao terminar, responda com:
   - a tabela "7. Veredito da stack mobile"
   - os roteiros de teste manual em device que preciso executar
   - as pendências `NÃO VERIFICADO`

## Regras
- Fail-closed: sem evidência oficial ou de spike, o status é `NÃO VERIFICADO` e a opção é tratada como inviável.
- Não altere outras seções, outros agentes nem o comando `/fase0`.
- Não instale dependências fora de `docs/phase0/spikes/expo-share/`.
- Não inicie a Fase 1 nem escreva código de produção.
- Pare no checkpoint e aguarde minha aprovação.
