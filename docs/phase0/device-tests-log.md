# Log de testes em device (Fase 0)

## §4.1: conteúdo do share sheet (Android)

Ambiente: emulador Android 13 (API 33, Google Play), `expo-share` SPIKE-15 (APK EAS `d8ce54b7`, `expo-share-intent@8.0.1`). Data: 2026-09-27.

| # | App de origem | Conteúdo | Caminho no app | expo-share aparece? | Payload recebido | Observações |
|---|---|---|---|---|---|---|
| A-01 | (simulado via `adb am start`) | texto + URL | — | n/a | `type=weburl`, `text` completo, `webUrl` extraído do texto | Funciona com app aberto e com app fechado (cold start) |
| A-02 | (simulado via `adb am start`) | imagem única (content URI do MediaStore) | — | n/a | **crash** `CursorIndexOutOfBoundsException` em `ExpoShareIntentModule.getFileInfo` (linha 71) | Plugin não verifica cursor vazio; ver achado F-01 |
| A-03 | YouTube 21.38 | Short | Share → (folha própria do YT) → More → expo-share | Sim, na folha nativa | `type=weburl`, `text` = `webUrl` = `https://youtube.com/shorts/<id>?is=<token>`; `files=null`; `meta={}` | Só URL: sem título/thumbnail. Parâmetro `is=` identifica quem compartilhou |
| A-04 | TikTok | — | Play Store no emulador | — | — | **Não testável no emulador**: a Play Store informa "Your device isn't compatible with this version" (o app só publica builds ARM; o emulador é x86_64). Precisa de aparelho físico |
| A-05 | YouTube 21.38 → **Fruiqo 0.1.0** (APK EAS `b79c1794`) | Short | Share → More → Fruiqo | Sim | `POST /shares` 201 → worker `done`: título/autor/thumbnail via oEmbed, URL sem `is=`, recomendação heurística `music_track` "What I've Done" / Linkin Park (50%) | Fluxo ponta a ponta da versão inicial validado no emulador |
| A-06 | Arquivos (DocumentsUI) → Fruiqo 0.1.0 com OCR (APK `493eb94b`) | print 1 de lista de filmes (itens 1–7 + ruído de UI) | toque longo → Compartilhar → Fruiqo | Sim | OCR no device (ML Kit), `pages` com 1 texto → 6 filmes novos com ano; ruído ("Seguir", "Curtido por…", "Ver todos os comentários") filtrado; `itemsAlreadyInList=1` ("Ainda Estou Aqui", salvo antes) | Primeira tentativa falhou com EACCES: o plugin passava o caminho absoluto em vez da `content://` → corrigido no patch (F-02) |
| A-07 | Arquivos → Fruiqo | print 2 (itens 5–12, sobrepõe 5–7) em share separado | idem | Sim | 5 filmes novos (8–12); `itemsAlreadyInList=3` (5–7) | Dedup entre shares validada |
| A-08 | Arquivos → Fruiqo | print 2 reenviado idêntico | idem | Sim | 0 itens; `pagesIgnored=1`; UI explica "Nada novo aqui" | Dedup por hash de página validada |
| A-09 | Instagram (logado no emulador) → expo-share (SPIKE-15) | Reel | Compartilhar → expo-share | Sim | `type=weburl`, `text` = `webUrl` = `https://www.instagram.com/reel/<id>/?stkn=<token>`; `files=null`; `meta={}` | **§4.1 Instagram (Reel, Android) respondido: só URL**, sem legenda/imagem. Novo parâmetro de rastreamento `stkn` (ainda não removido pelo normalizador — pendência) |

### Achados
- **F-01 (plugin, robustez)**: `getFileInfo` faz `cursor.moveToFirst()` sem checar retorno e chama `getString` numa linha inexistente; se o provider do app de origem devolver cursor vazio, o app inteiro fecha. Não confirmado com app real ainda (só com share simulado). Mitigação para a Fase 1: patch (`patch-package`) com checagem e `notifyError`, ou PR upstream.
- **F-02 (YouTube)**: o YouTube entrega apenas a URL. Título/descrição precisam vir de fonte oficial (oEmbed / Data API v3, ambas já avaliadas). Remover parâmetros de rastreamento (`is`, `si`, `feature`) antes de persistir.

- **F-02 (plugin, permissão)**: `parseShareIntent` preferia `file://<filePath>` à `content://`; sem permissão de armazenamento o ML Kit recebe EACCES. Corrigido em `patches/expo-share-intent@8.0.1.patch` (prefere `contentUri`).

- **F-03 (Instagram)**: o share do Reel entrega apenas a URL; legenda e mídia não chegam ao app. Confirma o caminho de prints + OCR para conteúdo do Instagram. O parâmetro `stkn` precisa entrar na lista de remoção de `apps/api/src/pipeline/normalize.ts`. Faltam: post de foto, carrossel, perfil (Android) e todos no iOS.
