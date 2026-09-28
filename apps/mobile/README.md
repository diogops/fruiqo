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

## Patch do expo-share-intent

`patches/expo-share-intent@8.0.1.patch` (registrado em `pnpm-workspace.yaml`) corrige o crash F-01 de `docs/phase0/device-tests-log.md`: com cursor vazio do provider de origem, o módulo agora reporta erro em vez de derrubar o app.
