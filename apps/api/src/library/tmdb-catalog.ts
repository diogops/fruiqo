import type { Env } from '../config/env.js';
import { PipelineGateway } from '../pipeline/gateway.js';
import { TmdbResolver } from '../pipeline/resolvers/tmdb.js';

/** TMDB para a API (busca RF-46, favoritos RF-43, alternativa na revisão RF-42/47). */
export const TMDB_CATALOG = Symbol('TMDB_CATALOG');

/** TMDB pelo PipelineGateway do modo configurado; em `mock` usa as gravações sintéticas. null = sem chave. */
export function createTmdbCatalog(env: Pick<Env, 'TMDB_API_KEY' | 'PIPELINE_MODE'>, gateway?: PipelineGateway): TmdbResolver | null {
  const key = env.TMDB_API_KEY ?? (env.PIPELINE_MODE === 'mock' ? 'mock-key' : undefined);
  if (!key) return null;
  const gw = gateway ?? new PipelineGateway({ mode: env.PIPELINE_MODE });
  return new TmdbResolver(key, gw.fetchImpl);
}
