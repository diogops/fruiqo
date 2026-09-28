import { Controller, Get } from '@nestjs/common';
import type { TaxonomyResponse } from '@fruiqo/contracts';
import { GENRES, SUBGENRES, TAXONOMY_VERSION } from '@fruiqo/taxonomy';

/** Vocabulário próprio de gêneros/subgêneros (taxonomy-v1). O app usa para editar gêneros de um título. */
@Controller('taxonomy')
export class TaxonomyController {
  @Get('genres')
  genres(): TaxonomyResponse {
    return {
      version: TAXONOMY_VERSION,
      genres: GENRES.map((g) => ({ key: g.key, label: g.label })),
      subgenres: SUBGENRES.map((s) => ({ key: s.key, label: s.label })),
    };
  }
}
