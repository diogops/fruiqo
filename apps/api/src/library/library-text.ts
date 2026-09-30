import { type SQL, ilike, or, sql } from 'drizzle-orm';
import { recommendations } from '../db/schema.js';
import { normalizeMoodText } from '@fruiqo/taxonomy';
import { type BrowseService, interpretBrowseQuery } from './browse-query.js';
import { interpretSearchQuery } from './search-query.js';

// D-23: o campo de busca da Minha Área e do Catálogo entende categoria ("sci-fi", "documentários",
// "minissérie", "séries de ação anos 90", "da Netflix"), além do nome. Leitura local, sem LLM.

/** nomes dos serviços como aparecem nas linhas de assinatura do TMDB/JustWatch */
const SERVICE_NAMES: Record<BrowseService, string[]> = {
  netflix: ['%netflix%'],
  prime: ['%prime video%', '%amazon%'],
  disney: ['%disney%'],
  max: ['%max%', '%hbo%'],
  apple: ['%apple tv%'],
  globoplay: ['%globoplay%'],
  paramount: ['%paramount%'],
  mubi: ['%mubi%'],
  crunchyroll: ['%crunchyroll%'],
};

const ONLY_KIND = /^(?:(?:os|as|meus|minhas) )?(filmes?|series?|seriados?|livros?|musicas?)$/;
const KIND_OF: Record<string, 'movie' | 'series' | 'book' | 'music_track'> = {
  filme: 'movie',
  serie: 'series',
  seriado: 'series',
  livro: 'book',
  musica: 'music_track',
};

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Condição do texto de busca: nome OU a categoria entendida (quando há uma). */
export function libraryTextCondition(text: string): SQL {
  const byTitle = ilike(recommendations.title, `%${escapeLike(text)}%`);
  const category = categoryCondition(text);
  return category ? or(byTitle, category)! : byTitle;
}

function categoryCondition(text: string): SQL | null {
  const browse = interpretBrowseQuery(text);
  const plain = interpretSearchQuery(text);
  // só o tipo: "séries", "filmes", "livros"
  const onlyKind = ONLY_KIND.exec(normalizeMoodText(text));
  if (onlyKind) return sql`${recommendations.kind} = ${KIND_OF[onlyKind[1]!.replace(/s$/, '')] ?? 'movie'}`;
  // sobrou nome de pessoa/título: não é só categoria
  if (browse?.person || (!browse && plain.type !== 'genre')) return null;

  const genres = browse?.genres.length ? browse.genres : plain.genres;
  const kind = browse?.kind ?? plain.kind;
  const decade = browse?.decade ?? plain.decade;
  const services = browse?.services ?? [];
  const recentFrom = browse?.releases === 'recent' || plain.recent ? new Date().getFullYear() - (browse?.releases ? 1 : 3) : undefined;
  const parts: SQL[] = [];
  if (genres.length) parts.push(sql`${recommendations.genres} && ARRAY[${sql.join(genres.map((g) => sql`${g}`), sql`, `)}]::text[]`);
  if (kind) parts.push(sql`${recommendations.kind} = ${kind}`);
  if (browse?.short) parts.push(sql`${recommendations.runtimeMin} <= 40`);
  if (decade) parts.push(sql`${recommendations.year} BETWEEN ${decade} AND ${decade + 9}`);
  if (recentFrom) parts.push(sql`${recommendations.year} >= ${recentFrom}`);
  if (services.length) {
    const patterns = services.flatMap((s) => SERVICE_NAMES[s]);
    parts.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(${recommendations.resolution}->'providers', '[]'::jsonb)) p
      WHERE p->>'type' = 'flatrate' AND p->>'name' ILIKE ANY(ARRAY[${sql.join(patterns.map((x) => sql`${x}`), sql`, `)}]::text[]))`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : null;
}
