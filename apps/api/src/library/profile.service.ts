import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { CreateFavoriteRequest, DeclaredTaste, Favorite, Resolution } from '@fruiqo/contracts';
import { GENRES, GENRE_KEYS, interpretTasteStatement, SUBGENRES } from '@fruiqo/taxonomy';
import { desc, eq } from 'drizzle-orm';
import { DB, type Db, withUser } from '../db/client.js';
import { tasteFavorites, tasteStatements } from '../db/schema.js';
import type { OpenLibraryResolver } from '../pipeline/resolvers/openlibrary.js';
import type { TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { declaredAffinity } from './fit.js';
import { OPENLIBRARY_CATALOG } from './openlibrary-catalog.js';
import { columnsFromResolution } from './tmdb-enrichment.js';
import { TMDB_CATALOG } from './tmdb-catalog.js';

const GENRE_SET = new Set<string>(GENRE_KEYS);
const GENRE_LABEL = new Map<string, string>(GENRES.map((g) => [g.key, g.label]));
const SUBGENRE_LABEL = new Map<string, string>(SUBGENRES.map((s) => [s.key, s.label]));
const MAX_FAVORITES = 100;
/** abaixo disto o favorito fica sem resolução (melhor sem gênero do que com o gênero errado) */
const FAVORITE_MIN_MATCH = 0.6;

type FavoriteRow = typeof tasteFavorites.$inferSelect;

/**
 * RF-43: perfil de gosto declarado. Favoritos (resolvidos no TMDB quando possível) e um resumo livre
 * interpretado por regras locais (sem LLM). O que foi entendido volta para o usuário ver e corrigir.
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(TMDB_CATALOG) private readonly tmdb: TmdbResolver | null,
    @Optional() @Inject(OPENLIBRARY_CATALOG) private readonly books: OpenLibraryResolver | null = null,
  ) {}

  async declared(userId: string): Promise<DeclaredTaste> {
    return withUser(this.db, userId, async (tx) => {
      const favorites = await tx.select().from(tasteFavorites).orderBy(desc(tasteFavorites.createdAt));
      const [statement] = await tx.select().from(tasteStatements);
      return buildDeclared(statement?.summary ?? null, favorites);
    });
  }

  async updateSummary(userId: string, summary: string): Promise<DeclaredTaste> {
    const text = summary.trim();
    await withUser(this.db, userId, async (tx) => {
      if (!text) {
        await tx.delete(tasteStatements);
        return;
      }
      const now = new Date();
      await tx
        .insert(tasteStatements)
        .values({ userId, summary: text, updatedAt: now })
        .onConflictDoUpdate({ target: tasteStatements.userId, set: { summary: text, updatedAt: now } });
    });
    return this.declared(userId);
  }

  async addFavorite(userId: string, input: CreateFavoriteRequest): Promise<Favorite> {
    // rede fora da transação
    const res = await this.resolve(input);
    const cols = columnsFromResolution(res);
    const book = res?.provider === 'openlibrary';
    const kind = input.kind ?? (book ? 'book' : res?.mediaType === 'tv' ? 'series' : res ? 'movie' : 'other');
    return withUser(this.db, userId, async (tx) => {
      const existing = await tx
        .select({ id: tasteFavorites.id, tmdbId: tasteFavorites.tmdbId, mediaType: tasteFavorites.mediaType, olWorkId: tasteFavorites.olWorkId })
        .from(tasteFavorites);
      if (existing.length >= MAX_FAVORITES) throw new ConflictException(`Limite de ${MAX_FAVORITES} favoritos atingido`);
      const dup = res?.olWorkId
        ? existing.find((e) => e.olWorkId === res.olWorkId)
        : res?.tmdbId != null
          ? existing.find((e) => e.tmdbId === res.tmdbId && e.mediaType === res.mediaType)
          : undefined;
      const values = {
        userId,
        title: res?.title ?? input.title,
        kind,
        year: input.year ?? cols?.year ?? null,
        rating: input.rating ?? null,
        comment: input.comment ?? null,
        genres: cols?.genres ?? [],
        tmdbId: res?.tmdbId ?? null,
        mediaType: book ? null : (res?.mediaType ?? null),
        olWorkId: res?.olWorkId ?? null,
        posterUrl: res?.imageUrl ?? null,
        resolvedAt: res ? new Date() : null,
      };
      // o mesmo título de novo atualiza nota/comentário em vez de duplicar
      const [row] = dup
        ? await tx.update(tasteFavorites).set(values).where(eq(tasteFavorites.id, dup.id)).returning()
        : await tx.insert(tasteFavorites).values(values).returning();
      return toFavorite(row!);
    });
  }

  async deleteFavorite(userId: string, id: string): Promise<void> {
    const deleted = await withUser(this.db, userId, (tx) => tx.delete(tasteFavorites).where(eq(tasteFavorites.id, id)).returning({ id: tasteFavorites.id }));
    if (deleted.length === 0) throw new NotFoundException('Favorito não encontrado');
  }

  private async resolve(input: CreateFavoriteRequest): Promise<Resolution | null> {
    // RF-48: livro escolhido na busca; sem a obra, o livro fica só com o título (sem busca por texto)
    if (input.olWorkId && (!input.kind || input.kind === 'book')) {
      if (!this.books) return null;
      try {
        return await this.books.byWorkId(input.olWorkId);
      } catch {
        return null;
      }
    }
    if (!this.tmdb) return null;
    if (input.kind && input.kind !== 'movie' && input.kind !== 'series') return null;
    try {
      if (input.tmdbId && input.mediaType) return await this.tmdb.byId(input.mediaType, input.tmdbId);
      const r = await this.tmdb.lookupDetailed({
        title: input.title,
        kind: input.kind === 'series' ? 'series' : 'movie',
        ...(input.year ? { year: input.year } : {}),
      });
      return r.resolution && (r.score ?? 0) >= FAVORITE_MIN_MATCH ? r.resolution : null;
    } catch {
      // sem TMDB (mock sem gravação, rede fora): o favorito fica sem gêneros, sem travar o cadastro
      return null;
    }
  }
}

export function toFavorite(r: FavoriteRow): Favorite {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    ...(r.year != null ? { year: r.year } : {}),
    ...(r.rating != null ? { rating: r.rating } : {}),
    ...(r.comment ? { comment: r.comment } : {}),
    genres: r.genres.filter((g) => GENRE_SET.has(g)).map((key) => ({ key, label: GENRE_LABEL.get(key)! })),
    ...(r.posterUrl ? { posterUrl: r.posterUrl } : {}),
    ...(r.tmdbId != null ? { tmdbId: r.tmdbId } : {}),
    ...(r.mediaType ? { mediaType: r.mediaType } : {}),
    ...(r.olWorkId ? { olWorkId: r.olWorkId } : {}),
    createdAt: r.createdAt.toISOString(),
  };
}

export function buildDeclared(summary: string | null, favorites: FavoriteRow[]): DeclaredTaste {
  const interp = summary ? interpretTasteStatement(summary) : null;
  const affinity = declaredAffinity(favorites, interp);
  const tag = (key: string) => ({ key, label: GENRE_LABEL.get(key) ?? key });
  const subTag = (key: string) => ({ key, label: SUBGENRE_LABEL.get(key) ?? key });
  return {
    summary,
    favorites: favorites.map(toFavorite),
    interpreted: {
      likes: (interp?.likes ?? []).map(tag),
      dislikes: (interp?.dislikes ?? []).map(tag),
      likedSubgenres: (interp?.likedSubgenres ?? []).map(subTag),
      dislikedSubgenres: (interp?.dislikedSubgenres ?? []).map(subTag),
    },
    affinities: [...affinity]
      .map(([key, a]) => ({ key, label: GENRE_LABEL.get(key) ?? key, score: a.score, source: a.source }))
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'pt-BR')),
  };
}
