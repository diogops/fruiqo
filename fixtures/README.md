# Fixtures sintéticas (RF-21)

Tudo aqui foi **escrito pelo time Fruiqo**. O repositório é público: nada de print real, post real
ou resposta real de API (TMDB, Spotify, YouTube, Anthropic). Prints e gravações reais ficam em
`fixtures-private/` (gitignored), no mesmo formato. A checagem `node tools/fixtures/check.mjs` roda
na CI e falha se algo aqui não estiver marcado como sintético.

Os arquivos são gerados por `tools/fixtures/build_fixtures.py` (conteúdo) e
`tools/fixtures/render_pages.py` (PNG de cada `page-N.ocr.txt`). Edite o script, não os arquivos.

## Formato

| Arquivo | Conteúdo |
|---|---|
| `meta.json` | `id`, `kind` (`screenshot` / `text` / `url` / `sequence` / `mood-set` / `text_file`), `description`, `synthetic: true`, `origin`, `license`, `version` |
| `input.json` / `input.txt` | Entrada do share: `{pages}`, `{url}`, `{text}`, `{textFile: {name, file}}` (.txt importado, RF-47) ou `{shares: [...]}` (sequência); `input.txt` = texto colado |
| `page-N.ocr.txt` | Texto esperado do OCR do print N (é o que o device mandaria em `pages`) |
| `page-N.png` | Print renderizado a partir do `.ocr.txt` (para o simulador e para OCR real em emulador) |
| `expected.json` | `status`, `items` (`title`, `kind`, `year?`, `creator?`, `tmdbId?`), `forbidden?`, `source?`, `dedup?`; sequência: `shares[]`; humor: `cases[]` |
| `recordings/*.json` | Respostas simuladas para `PIPELINE_MODE=mock` (`synthetic: true`, não vencem) |

Os dados de catálogo das gravações usam obras e IDs **fictícios** (TOS-REQ-02: dado real do TMDB
nunca é versionado).
