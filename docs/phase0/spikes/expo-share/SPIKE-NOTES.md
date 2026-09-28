# SPIKE-12 — Expo + expo-share-intent — prebuild

Objetivo: verificar se `npx expo prebuild` gera o intent-filter Android (`ACTION_SEND`) e a Share Extension iOS ao configurar o plugin `expo-share-intent` num projeto Expo mínimo, no ambiente disponível (Windows + Git Bash).

Regras respeitadas: nenhuma dependência instalada fora desta pasta; nenhum build assinado; nenhuma credencial/login Apple ou EAS; nada publicado.

## Ambiente

- SO: Windows 10 Pro 10.0.19045 (via Git Bash)
- Node: v20.20.0 / npm: 9.8.1
- `create-expo@5.0.2` avisou (EBADENGINE) que espera Node `^22.13.0 || ^24.3.0 || ^26.0.0 || >=27.0.0`; prosseguiu mesmo assim.
- Expo SDK instalado: **57.0.25** (`expo@~57.0.25`, `react-native@0.86.3`, `react@19.2.3`) — SDK atual conforme `expo.dev/changelog/sdk-57` (lançado 2026-06-30).
- Plugin instalado: **expo-share-intent@8.0.1** (release 2026-07-10, primeira versão da série 8.x com suporte a SDK 57 lançada em 8.0.0 em 2026-07-03) — https://github.com/achorein/expo-share-intent/releases

## Comandos executados

```bash
npx --yes create-expo-app@latest expo-share --template blank-typescript
npm install expo-share-intent
# app.json editado manualmente para incluir "scheme" e o plugin com
# iosActivationRules (URL, página web, imagem, filme) e
# androidIntentFilters: ["text/*", "image/*"]
npx expo prebuild --platform android --no-install
npx expo prebuild --platform ios --no-install
npx expo prebuild --no-install   # sem --platform, para ver comportamento default
```

## Resultados

### Android — SUCESSO

`npx expo prebuild --platform android --no-install` (e também o `prebuild` sem `--platform`) gerou `android/app/src/main/AndroidManifest.xml` com o intent-filter esperado:

```xml
<action android:name="android.intent.action.SEND"/>
<data android:mimeType="text/*"/>
<data android:mimeType="image/*"/>
<category android:name="android.intent.category.DEFAULT"/>
```

O log do config plugin confirmou a aplicação da configuração:
`[expo-share-intent] add android filters (text/* image/*) and multi-filters ()`

**Conclusão:** confirmado por spike que o plugin gera corretamente o intent-filter `ACTION_SEND` no Android a partir da config declarativa em `app.json`, sem intervenção manual no `AndroidManifest.xml`.

### iOS — NÃO GERADO (limitação de plataforma do host, não do plugin)

`npx expo prebuild --platform ios --no-install` retornou:

```
⚠️  Skipping generating the iOS native project files. Run npx expo prebuild again from macOS or Linux to generate the iOS project.
CommandError: At least one platform must be enabled when syncing
```

Repetindo `npx expo prebuild` sem `--platform` (esperando que ao menos gerasse os arquivos base e pulasse só a parte que precisa do Xcode/CocoaPods): resultado foi o mesmo comportamento — **nenhum diretório `ios/` foi criado**. Confirmado com `ls` que não existe `ios/` no projeto após a execução.

**Conclusão:** ao contrário da hipótese registrada na tarefa ("o prebuild de iOS pode gerar os arquivos nativos mas não compilar"), na prática o Expo CLI **recusa-se a gerar qualquer arquivo nativo iOS quando executado em Windows** — a geração do projeto iOS (incluindo o alvo da Share Extension que o `expo-share-intent` adicionaria via config plugin) exige host macOS ou Linux. Isso não é uma limitação do plugin `expo-share-intent` especificamente, é uma limitação do próprio `expo prebuild` para a plataforma iOS. **NÃO VERIFICADO neste ambiente** se a Share Extension é de fato gerada corretamente pelo plugin — precisa ser repetido em macOS (ou Linux, se suficiente) ou via EAS Build antes de qualquer decisão.

## Artefatos

- Projeto completo (sem `node_modules`, que não deve ser versionado) em `docs/phase0/spikes/expo-share/`.
- `android/app/src/main/AndroidManifest.xml` gerado e preservado como evidência.
- Nenhum diretório `ios/` existe (resultado do próprio spike, não uma omissão).
