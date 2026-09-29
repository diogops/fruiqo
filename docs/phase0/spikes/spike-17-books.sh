#!/usr/bin/env bash
# SPIKE-17 — Open Library (search.json) e Google Books (volumes) sem chave/credencial
# Objetivo: qualidade de busca/match para livros em portugues (Brasil) por titulo,
# titulo+autor e ISBN, e quais campos cada API retorna (titulo, autores, ano, capa,
# sinopse, assuntos/generos, paginas, ISBN, idioma).
#
# Regras respeitadas:
# - So GET publico, documentado, sem autenticacao (nenhuma API key usada).
# - Open Library recomenda (nao exige) um User-Agent identificado com contato; usamos
#   um contato de placeholder do projeto (nao e segredo, nao e PII do usuario), via
#   variavel de ambiente com valor padrao — nada e gravado em log/arquivo alem deste
#   script e do resumo em texto.
# - Google Books: uso leve sem `key=` (documentado como permitido; sujeito a cota
#   global compartilhada, nao a uma cota por projeto/IP — ver resultado abaixo).
#
# Uso: rodar de dentro da raiz do repo (usa uma pasta temporaria local, evitando
# problemas de mapeamento /tmp entre bash (MSYS) e python nativo do Windows).
set -euo pipefail

BOOKS_CONTACT="${BOOKS_CONTACT:-fruiqo-phase0-spike@example.com}"
UA="Fruiqo-Phase0-Spike/0.1 (contato: $BOOKS_CONTACT)"

OL_BASE="https://openlibrary.org/search.json"
GB_BASE="https://www.googleapis.com/books/v1/volumes"

TMP_DIR="./.spike17_tmp"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

# title|query_ol|query_gb|origem
TITLES=(
  "Dom Casmurro|Dom Casmurro Machado de Assis|intitle:Dom Casmurro inauthor:Machado de Assis|BR classico"
  "Torto Arado|Torto Arado Itamar Vieira Junior|intitle:Torto Arado inauthor:Itamar Vieira Junior|BR contemporaneo"
  "Ainda Estou Aqui|Ainda Estou Aqui Marcelo Rubens Paiva|intitle:Ainda Estou Aqui inauthor:Marcelo Rubens Paiva|BR contemporaneo"
  "Capitaes da Areia|Capitaes da Areia Jorge Amado|intitle:Capitaes da Areia inauthor:Jorge Amado|BR classico"
  "Memorias Postumas de Bras Cubas|Memorias Postumas de Bras Cubas Machado de Assis|intitle:Memorias Postumas de Bras Cubas inauthor:Machado de Assis|BR classico"
  "O Pequeno Principe|O Pequeno Principe Antoine de Saint-Exupery|intitle:O Pequeno Principe inauthor:Saint-Exupery|Intl traduzido"
  "1984|1984 George Orwell|intitle:1984 inauthor:George Orwell|Intl traduzido"
  "Harry Potter e a Pedra Filosofal|Harry Potter e a Pedra Filosofal J.K. Rowling|intitle:Harry Potter e a Pedra Filosofal inauthor:Rowling|Intl traduzido"
)

echo "### SPIKE-17 — Open Library search.json (lang=por) ###"
i=0
for row in "${TITLES[@]}"; do
  i=$((i+1))
  IFS='|' read -r label ol_q gb_q origem <<< "$row"
  out="$TMP_DIR/ol_$i.json"
  code=$(curl -s -A "$UA" -o "$out" -w "%{http_code}" \
    --get "$OL_BASE" \
    --data-urlencode "q=$ol_q" \
    --data-urlencode "language=por" \
    --data-urlencode "limit=3" \
    --data-urlencode "fields=title,author_name,first_publish_year,cover_i,isbn,subject,language,number_of_pages_median,edition_count")
  echo "--- [$origem] $label -> HTTP $code ---"
  python -c "
import json,sys
try:
    d=json.load(open(r'$out', encoding='utf-8'))
except Exception as e:
    print('  parse error:', e); sys.exit(0)
print('  numFound:', d.get('numFound'))
docs=d.get('docs',[])
if not docs:
    print('  (nenhum resultado)')
for doc in docs[:2]:
    print('  - title:', doc.get('title'))
    print('    author_name:', doc.get('author_name'))
    print('    first_publish_year:', doc.get('first_publish_year'))
    print('    cover_i presente:', 'cover_i' in doc)
    print('    isbn (qtd):', len(doc.get('isbn') or []))
    print('    language:', doc.get('language'))
    print('    subject (qtd, amostra):', len(doc.get('subject') or []), (doc.get('subject') or [])[:5])
    print('    number_of_pages_median:', doc.get('number_of_pages_median'))
"
  sleep 1  # respeita 1 req/s (User-Agent identificado permite 3/s, mas ficamos conservadores)
done

echo
echo "### SPIKE-17 — Google Books volumes (country=BR, sem key) ###"
i=0
STOP_GB=0
for row in "${TITLES[@]}"; do
  i=$((i+1))
  IFS='|' read -r label ol_q gb_q origem <<< "$row"
  if [ "$STOP_GB" = "1" ]; then
    echo "--- [$origem] $label -> PULADO (429 confirmado na primeira tentativa, ver abaixo) ---"
    continue
  fi
  out="$TMP_DIR/gb_$i.json"
  code=$(curl -s -o "$out" -w "%{http_code}" \
    --get "$GB_BASE" \
    --data-urlencode "q=$gb_q" \
    --data-urlencode "country=BR" \
    --data-urlencode "maxResults=3")
  echo "--- [$origem] $label -> HTTP $code ---"
  if [ "$code" = "429" ]; then
    echo "  corpo do erro:"
    python -c "
import json
d=json.load(open(r'$out', encoding='utf-8'))
err=d.get('error',{})
print('   message:', err.get('message'))
for det in err.get('details', []):
    if 'metadata' in det:
        print('   metadata:', det['metadata'])
"
    STOP_GB=1
    continue
  fi
  python -c "
import json,sys
try:
    d=json.load(open(r'$out', encoding='utf-8'))
except Exception as e:
    print('  parse error:', e); sys.exit(0)
print('  totalItems:', d.get('totalItems'))
items=d.get('items',[])
if not items:
    print('  (nenhum resultado)')
for it in items[:2]:
    vi=it.get('volumeInfo',{})
    print('  - title:', vi.get('title'), '/ subtitle:', vi.get('subtitle'))
    print('    authors:', vi.get('authors'))
    print('    publishedDate:', vi.get('publishedDate'))
    print('    language:', vi.get('language'))
    print('    categories:', vi.get('categories'))
    print('    pageCount:', vi.get('pageCount'))
    print('    description presente:', 'description' in vi, '(tam.:', len(vi.get('description','')), ')')
    print('    imageLinks presente:', 'imageLinks' in vi)
    print('    industryIdentifiers:', vi.get('industryIdentifiers'))
    print('    infoLink:', vi.get('infoLink'))
"
done

echo
echo "### SPIKE-17b — busca por ISBN (Open Library e Google Books) ###"
echo "ISBN de teste: 8535914846 (Dom Casmurro, edicao BR, Editora Nova Fronteira)"
out="$TMP_DIR/ol_isbn.json"
code=$(curl -s -A "$UA" -o "$out" -w "%{http_code}" -L "https://openlibrary.org/isbn/8535914846.json")
echo "Open Library GET /isbn/{isbn}.json (segue redirect) -> HTTP $code"
head -c 500 "$out"; echo

if [ "$STOP_GB" = "1" ]; then
  echo
  echo "Google Books GET /volumes?q=isbn:8535914846 -> PULADO (429 ja confirmado acima)"
else
  out="$TMP_DIR/gb_isbn.json"
  code=$(curl -s -o "$out" -w "%{http_code}" --get "$GB_BASE" --data-urlencode "q=isbn:8535914846")
  echo
  echo "Google Books GET /volumes?q=isbn:8535914846 -> HTTP $code"
  python -c "
import json
d=json.load(open(r'$out', encoding='utf-8'))
print('totalItems:', d.get('totalItems'))
for it in d.get('items',[])[:1]:
    vi=it.get('volumeInfo',{})
    print('title:', vi.get('title'), '| authors:', vi.get('authors'), '| publishedDate:', vi.get('publishedDate'))
"
fi
