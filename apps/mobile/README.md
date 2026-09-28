# @fruiqo/mobile

App Expo (SDK 57, Expo Router) que recebe links do share sheet (Instagram, YouTube, TikTok) e mostra as recomendações extraídas pela API.

O app usa módulo nativo (`expo-share-intent`), então **não roda no Expo Go**: é preciso um build (EAS ou `expo run:android`).

## Variáveis

| Variável | Uso | Padrão |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | URL da API do Fruiqo (não é segredo; vai no bundle) | `http://10.0.2.2:4000` (emulador Android → host) |
| `APP_VARIANT` | `development` / `preview` permitem HTTP (API local); `production` só HTTPS | `development` |

Nenhuma chave de terceiro (Anthropic, TMDB, Spotify) fica no app: tudo passa pela API (SEC-REQ-10).

## Rodar

```bash
pnpm install                      # na raiz do monorepo (aplica o patch do expo-share-intent)
pnpm --filter @fruiqo/contracts build
cd apps/mobile
pnpm typecheck && pnpm test
```

Com o APK de preview instalado no emulador, a API local precisa estar em `0.0.0.0:4000` no host. Num celular físico, use o IP da máquina na rede (`EXPO_PUBLIC_API_URL=http://192.168.x.x:4000`).

## APK de preview (EAS)

```bash
cd apps/mobile
eas build --profile preview-apk --platform android
```

Para um celular físico, troque `EXPO_PUBLIC_API_URL` no profile `preview-apk` do `eas.json` pelo IP da máquina antes do build. O profile `ios-sim` gera um build para o iOS Simulator (sem conta Apple paga).

## Prints de tela (OCR no aparelho)

Compartilhar 1 a 10 imagens (ex.: prints de um post com lista longa) roda OCR **no device** com
`expo-text-extractor` (ML Kit via Play Services no Android, Apple Vision no iOS). A imagem nunca sai do
aparelho (TOS-REQ-21): cada print vira uma página de texto em `CreateShareRequest.pages`, na ordem recebida.

- Montagem das páginas em `src/share/screenshotPages.ts` (função pura, testada): apara linhas, remove vazias,
  corta em 8000 caracteres, descarta prints sem texto e usa só os 10 primeiros.
- Se há imagens no share, só elas são usadas (texto/URL do mesmo share são ignorados); PDF continua sem suporte.
- Páginas extraídas ficam pendentes só em memória até login/consentimento (texto de terceiros não vai para disco).
- A deduplicação (print repetido, sobreposição entre prints, item que já está na lista) é feita na API;
  o detalhe mostra `dedup.pagesIgnored` e `dedup.itemsAlreadyInList`.
- O Expo Go não serve: precisa do build (módulo nativo). No emulador Android, o ML Kit exige Google Play Services.

## Importar prints de dentro do app (RF-40)

O botão **Importar prints** na inbox abre três opções, e todas seguem o mesmo caminho do share (`src/share/useImageIngestion.tsx` → OCR no aparelho → `CreateShareRequest.pages`):

| Opção | Como | Permissão |
|---|---|---|
| Galeria | `expo-image-picker` (Photo Picker no Android, PHPicker no iOS), até 10, na ordem escolhida | nenhuma |
| Arquivos | `expo-document-picker` (imagens; PDF mostra "chega na próxima versão", RF-18b) | nenhuma |
| Câmera | `expo-image-picker` `launchCameraAsync`, várias fotos em sequência ("Tirar outra"/"Concluir") | câmera, pedida só no uso |

O `app.config.js` bloqueia `READ_MEDIA_*`, `READ/WRITE_EXTERNAL_STORAGE` e `RECORD_AUDIO` (`android.blockedPermissions`) e, no iOS, não declara `NSPhotoLibraryUsageDescription` nem microfone. A seleção e a montagem do payload são funções puras em `src/share/ingestImages.ts`, testadas para gerar o mesmo payload do share (exceto `clientShareId`).

## Patch do expo-share-intent

`patches/expo-share-intent@8.0.1.patch` (registrado em `pnpm-workspace.yaml`) corrige o crash F-01 de `docs/phase0/device-tests-log.md`: com cursor vazio do provider de origem, o módulo agora reporta erro em vez de derrubar o app.

## Desenvolvimento rápido (development build + Metro)

O app **Fruiqo (dev)** (`com.fruiqo.app.dev`, profile `development` do `eas.json`) instala ao lado do preview e carrega o JavaScript do Metro rodando no seu PC. Mudanças de tela/lógica aparecem na hora (Fast Refresh); só uma biblioteca **nativa** nova exige outro build.

```bash
# uma vez (ou quando entrar lib nativa): build e instalação
EAS_NO_VCS=1 EAS_PROJECT_ROOT=../.. eas build --profile development --platform android

# no dia a dia (emulador ligado + API em :4000)
pnpm --filter @fruiqo/mobile dev
```

O script faz `adb reverse` das portas 8081 (Metro) e 4000 (API) e sobe o Metro com `APP_VARIANT=development`. No emulador, abra **Fruiqo (dev)**; Ctrl+M abre o menu de desenvolvimento.
