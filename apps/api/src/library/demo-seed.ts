import type { GenreKey } from '@fruiqo/taxonomy';
import { and, eq, inArray } from 'drizzle-orm';
import { type Db, withUser } from '../db/client.js';
import { listItems, lists, recommendations, tasteSignals } from '../db/schema.js';
import { dedupKey } from '../pipeline/dedup.js';

// Seed de demonstração (RF-17). Gêneros, durações e atributos escritos pelo time a partir de
// conhecimento geral (nenhum dado copiado do TMDB): `enrichment = 'demo'`. Não apaga nada do usuário;
// títulos que ele já tem (mesma dedup_key) são reaproveitados.

type Kind = 'movie' | 'series';
interface DemoTitle {
  title: string;
  year: number;
  kind: Kind;
  genres: GenreKey[];
  runtimeMin?: number;
  attributes?: string[];
  priority?: number;
}

export const DEMO_TITLES: DemoTitle[] = [
  { title: 'Questão de Tempo', year: 2013, kind: 'movie', genres: ['comedy', 'romance', 'drama'], runtimeMin: 123 },
  { title: 'Simplesmente Amor', year: 2003, kind: 'movie', genres: ['comedy', 'romance'], runtimeMin: 135 },
  { title: 'Como Perder um Homem em 10 Dias', year: 2003, kind: 'movie', genres: ['comedy', 'romance'], runtimeMin: 116 },
  { title: 'Todo Mundo em Pânico', year: 2000, kind: 'movie', genres: ['comedy'], runtimeMin: 88 },
  { title: 'Apertem os Cintos… o Piloto Sumiu!', year: 1980, kind: 'movie', genres: ['comedy'], runtimeMin: 88 },
  { title: 'Se Beber, Não Case!', year: 2009, kind: 'movie', genres: ['comedy'], runtimeMin: 100 },
  { title: 'O Auto da Compadecida', year: 2000, kind: 'movie', genres: ['comedy', 'drama'], runtimeMin: 104, priority: 2 },
  { title: 'Intocáveis', year: 2011, kind: 'movie', genres: ['comedy', 'drama'], runtimeMin: 112, priority: 2 },
  { title: 'À Procura da Felicidade', year: 2006, kind: 'movie', genres: ['drama'], runtimeMin: 117 },
  { title: 'Divertida Mente', year: 2015, kind: 'movie', genres: ['animation', 'family', 'comedy'], runtimeMin: 95 },
  { title: 'Up: Altas Aventuras', year: 2009, kind: 'movie', genres: ['animation', 'family', 'adventure'], runtimeMin: 96 },
  { title: 'Paddington 2', year: 2017, kind: 'movie', genres: ['family', 'comedy', 'adventure'], runtimeMin: 104 },
  { title: 'Diário de uma Paixão', year: 2004, kind: 'movie', genres: ['drama', 'romance'], runtimeMin: 123, attributes: ['sad_ending'] },
  { title: 'A Culpa é das Estrelas', year: 2014, kind: 'movie', genres: ['drama', 'romance'], runtimeMin: 126, attributes: ['sad_ending'] },
  { title: 'Clube da Luta', year: 1999, kind: 'movie', genres: ['drama', 'thriller'], runtimeMin: 139 },
  { title: 'Garota Exemplar', year: 2014, kind: 'movie', genres: ['thriller', 'mystery', 'drama'], runtimeMin: 149 },
  { title: 'A Origem', year: 2010, kind: 'movie', genres: ['scifi', 'thriller', 'action'], runtimeMin: 148 },
  { title: 'Interestelar', year: 2014, kind: 'movie', genres: ['scifi', 'drama', 'adventure'], runtimeMin: 169 },
  { title: 'Invocação do Mal', year: 2013, kind: 'movie', genres: ['horror', 'mystery'], runtimeMin: 112 },
  { title: 'Corra!', year: 2017, kind: 'movie', genres: ['horror', 'thriller', 'mystery'], runtimeMin: 104 },
  { title: 'Onze Homens e um Segredo', year: 2001, kind: 'movie', genres: ['crime', 'thriller'], runtimeMin: 116 },
  { title: 'Tropa de Elite', year: 2007, kind: 'movie', genres: ['crime', 'action', 'drama'], runtimeMin: 115, attributes: ['violence'] },
  { title: 'Cidade de Deus', year: 2002, kind: 'movie', genres: ['crime', 'drama'], runtimeMin: 130, attributes: ['violence'] },
  { title: 'O Senhor dos Anéis: A Sociedade do Anel', year: 2001, kind: 'movie', genres: ['adventure', 'fantasy'], runtimeMin: 178 },
  { title: 'Central do Brasil', year: 1998, kind: 'movie', genres: ['drama'], runtimeMin: 113 },
  { title: 'Ted Lasso', year: 2020, kind: 'series', genres: ['comedy', 'drama'], priority: 2 },
  { title: 'Brooklyn Nine-Nine', year: 2013, kind: 'series', genres: ['comedy', 'crime'] },
  { title: 'The Office', year: 2005, kind: 'series', genres: ['comedy'] },
  { title: 'Dark', year: 2017, kind: 'series', genres: ['scifi', 'mystery', 'thriller'] },
  { title: 'Stranger Things', year: 2016, kind: 'series', genres: ['scifi', 'horror', 'drama'] },
  { title: 'Chernobyl', year: 2019, kind: 'series', genres: ['drama', 'history'] },
  { title: 'Round 6', year: 2021, kind: 'series', genres: ['thriller', 'drama', 'action'], attributes: ['violence'] },
];

/** Listas do seed; a "Maratona" já está em andamento (2 assistidos) para o "Continuar". */
const DEMO_LISTS: { name: string; titles: string[]; watched: number; pinned?: boolean }[] = [
  {
    name: 'Maratona de comédias da semana',
    titles: ['Todo Mundo em Pânico', 'Se Beber, Não Case!', 'O Auto da Compadecida', 'Intocáveis', 'Paddington 2'],
    watched: 2,
  },
  { name: 'Séries para começar', titles: ['Ted Lasso', 'Dark', 'Brooklyn Nine-Nine', 'Chernobyl'], watched: 0 },
  { name: 'Para ver a dois', titles: ['Questão de Tempo', 'Simplesmente Amor', 'Divertida Mente'], watched: 0 },
];

/** Notas de gosto do usuário demo (viram sinais `rated`). */
const DEMO_RATINGS: Record<string, number> = {
  'Todo Mundo em Pânico': 4,
  'Se Beber, Não Case!': 5,
  'Invocação do Mal': 2,
};

export interface DemoSeedResult {
  titles: number;
  created: number;
  lists: number;
  idByTitle: Map<string, string>;
}

export async function seedDemo(db: Db, userId: string): Promise<DemoSeedResult> {
  return withUser(db, userId, async (tx) => {
    const now = new Date();
    const rows = DEMO_TITLES.map((t, i) => ({
      userId,
      shareId: null,
      kind: t.kind,
      title: t.title,
      year: t.year,
      creator: null,
      confidence: 1,
      extractor: 'heuristic' as const,
      dedupKey: dedupKey({ kind: t.kind, title: t.title }),
      decision: 'cataloged' as const,
      decisionReason: 'demo_seed',
      genres: t.genres,
      attributes: t.attributes ?? [],
      runtimeMin: t.runtimeMin ?? null,
      priority: t.priority ?? 1,
      enrichment: 'demo' as const,
      // ordem estável de criação (desempate do ranking)
      createdAt: new Date(now.getTime() - (DEMO_TITLES.length - i) * 60_000),
      updatedAt: now,
    }));
    const inserted = await tx
      .insert(recommendations)
      .values(rows)
      .onConflictDoNothing({ target: [recommendations.userId, recommendations.dedupKey] })
      .returning({ id: recommendations.id });

    // itens que o usuário já tinha: ganham gêneros do seed só se ainda não tiverem nenhum
    const keys = rows.map((r) => r.dedupKey);
    const all = await tx
      .select({ id: recommendations.id, key: recommendations.dedupKey, genres: recommendations.genres })
      .from(recommendations)
      .where(inArray(recommendations.dedupKey, keys));
    const byKey = new Map(all.map((r) => [r.key, r]));
    for (const r of rows) {
      const existing = byKey.get(r.dedupKey);
      if (existing && existing.genres.length === 0) {
        await tx
          .update(recommendations)
          .set({ genres: r.genres, attributes: r.attributes, runtimeMin: r.runtimeMin, enrichment: 'demo', updatedAt: now })
          .where(eq(recommendations.id, existing.id));
      }
    }
    const idByTitle = new Map(DEMO_TITLES.map((t, i) => [t.title, byKey.get(rows[i]!.dedupKey)!.id]));

    let listsCreated = 0;
    for (const def of DEMO_LISTS) {
      const [already] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.name, def.name)));
      if (already) continue;
      const [list] = await tx.insert(lists).values({ userId, name: def.name, pinned: def.pinned ?? false }).returning({ id: lists.id });
      const ids = def.titles.map((t) => idByTitle.get(t)!);
      await tx.insert(listItems).values(ids.map((recommendationId, position) => ({ listId: list!.id, recommendationId, userId, position })));
      if (def.watched > 0) {
        const watched = ids.slice(0, def.watched);
        await tx.update(recommendations).set({ status: 'watched', updatedAt: now }).where(inArray(recommendations.id, watched));
        await tx.insert(tasteSignals).values(watched.map((recommendationId) => ({ userId, recommendationId, signal: 'watched' as const })));
      }
      listsCreated++;
    }

    for (const [title, rating] of Object.entries(DEMO_RATINGS)) {
      const id = idByTitle.get(title)!;
      const [row] = await tx.select({ rating: recommendations.rating }).from(recommendations).where(eq(recommendations.id, id));
      if (row?.rating != null) continue;
      await tx.update(recommendations).set({ rating, status: 'watched', updatedAt: now }).where(eq(recommendations.id, id));
      await tx.insert(tasteSignals).values({ userId, recommendationId: id, signal: 'rated', value: rating });
    }

    return { titles: DEMO_TITLES.length, created: inserted.length, lists: listsCreated, idByTitle };
  });
}
