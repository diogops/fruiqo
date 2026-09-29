import type { Env } from '../config/env.js';
import { PipelineGateway } from '../pipeline/gateway.js';
import { OpenLibraryResolver } from '../pipeline/resolvers/openlibrary.js';

/** Open Library para a API (livros: busca RF-46, alternativa na revisão, enriquecimento; RF-48/D-21). */
export const OPENLIBRARY_CATALOG = Symbol('OPENLIBRARY_CATALOG');

/** Sem chave: existe em todos os modos; em `mock` as respostas vêm das gravações sintéticas. */
export function createOpenLibraryCatalog(env: Pick<Env, 'PIPELINE_MODE' | 'OPENLIBRARY_CONTACT'>, gateway?: PipelineGateway): OpenLibraryResolver {
  const gw = gateway ?? new PipelineGateway({ mode: env.PIPELINE_MODE });
  return new OpenLibraryResolver(env.OPENLIBRARY_CONTACT, gw.fetchImpl, gw.mode !== 'mock');
}
