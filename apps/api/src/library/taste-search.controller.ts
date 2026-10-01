import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type ImproveSummaryRequest,
  ImproveSummaryRequestSchema,
  type SummaryDraft,
  type Title,
  type TonightRequest,
  TonightRequestSchema,
  type TonightResponse,
  type TonightWatchedRequest,
  TonightWatchedRequestSchema,
  type AiFindTitlesRequest,
  AiFindTitlesRequestSchema,
  type AiFindTitlesResponse,
  type ApplyPriorityDraftRequest,
  ApplyPriorityDraftRequestSchema,
  type ApplyPriorityDraftResponse,
  type CreateFavoriteRequest,
  CreateFavoriteRequestSchema,
  type CreatePriorityDraftRequest,
  CreatePriorityDraftRequestSchema,
  type DeclaredTaste,
  type Favorite,
  type ClassifyTitlesRequest,
  ClassifyTitlesRequestSchema,
  type ClassifyTitlesResponse,
  type ImportTitlesRequest,
  ImportTitlesRequestSchema,
  type ImportTitlesResponse,
  type PriorityDraft,
  type TitleSearchQuery,
  TitleSearchQuerySchema,
  type TitleSearchResponse,
  type UpdatePriorityDraftRequest,
  UpdatePriorityDraftRequestSchema,
  type UpdateTasteSummaryRequest,
  UpdateTasteSummaryRequestSchema,
} from '@fruiqo/contracts';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { PriorityDraftService } from './priority-draft.service.js';
import { ProfileService } from './profile.service.js';
import { SearchService } from './search.service.js';
import { TonightService } from './tonight.service.js';

/** RF-43: perfil de gosto declarado (favoritos + resumo livre). */
@Controller('profile')
export class DeclaredProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly tonight: TonightService,
  ) {}

  /** D-25: resumo montado das suas escolhas (local, sem IA); só vale depois de salvo */
  @Get('summary/suggestion')
  suggestSummary(@CurrentAuth() auth: AccessClaims): Promise<SummaryDraft> {
    return this.tonight.suggestSummary(auth.userId);
  }

  /** D-25: a IA reescreve o texto do resumo (com consentimento); só vale depois de salvo */
  @Post('summary/improve')
  @HttpCode(200)
  improveSummary(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(ImproveSummaryRequestSchema)) body: ImproveSummaryRequest): Promise<SummaryDraft> {
    return this.tonight.improveSummary(auth.userId, body.text);
  }

  @Get('declared')
  declared(@CurrentAuth() auth: AccessClaims): Promise<DeclaredTaste> {
    return this.profile.declared(auth.userId);
  }

  @Put('summary')
  summary(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(UpdateTasteSummaryRequestSchema)) body: UpdateTasteSummaryRequest): Promise<DeclaredTaste> {
    return this.profile.updateSummary(auth.userId, body.summary);
  }

  @Post('favorites')
  addFavorite(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(CreateFavoriteRequestSchema)) body: CreateFavoriteRequest): Promise<Favorite> {
    return this.profile.addFavorite(auth.userId, body);
  }

  @Delete('favorites/:id')
  @HttpCode(204)
  deleteFavorite(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.profile.deleteFavorite(auth.userId, id);
  }
}

/**
 * RF-44 e RF-46 em /library. Registrado ANTES do LibraryController: `priority-draft` e `import`
 * não podem cair em `/library/:id`.
 */
@Controller('library')
export class LibraryExtrasController {
  constructor(
    private readonly drafts: PriorityDraftService,
    private readonly search: SearchService,
  ) {}

  @Post('priority-draft')
  createDraft(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(CreatePriorityDraftRequestSchema.optional())) body: CreatePriorityDraftRequest | undefined): Promise<PriorityDraft> {
    return this.drafts.create(auth.userId, body ?? {});
  }

  @Get('priority-draft')
  getDraft(@CurrentAuth() auth: AccessClaims): Promise<PriorityDraft> {
    return this.drafts.get(auth.userId);
  }

  @Patch('priority-draft')
  updateDraft(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(UpdatePriorityDraftRequestSchema)) body: UpdatePriorityDraftRequest): Promise<PriorityDraft> {
    return this.drafts.update(auth.userId, body);
  }

  @Post('priority-draft/apply')
  @HttpCode(200)
  applyDraft(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodPipe(ApplyPriorityDraftRequestSchema.optional())) body: ApplyPriorityDraftRequest | undefined,
  ): Promise<ApplyPriorityDraftResponse> {
    return this.drafts.apply(auth.userId, body ?? {});
  }

  @Delete('priority-draft')
  @HttpCode(204)
  discardDraft(@CurrentAuth() auth: AccessClaims): Promise<void> {
    return this.drafts.discard(auth.userId);
  }

  @Post('import')
  @HttpCode(200)
  importTitles(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(ImportTitlesRequestSchema)) body: ImportTitlesRequest): Promise<ImportTitlesResponse> {
    return this.search.import(auth.userId, body);
  }
}

/** RF-46: busca inteligente de títulos. */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('titles')
  titles(@CurrentAuth() auth: AccessClaims, @Query(new ZodPipe(TitleSearchQuerySchema)) query: TitleSearchQuery): Promise<TitleSearchResponse> {
    return this.search.search(auth.userId, query.q, query.kind, query.ai === '1', query.sort);
  }

  /** D-23: categoria (Filme/Série) sugerida pelo TMDB para os títulos lidos num import */
  @Post('classify')
  @HttpCode(200)
  classify(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(ClassifyTitlesRequestSchema)) body: ClassifyTitlesRequest): Promise<ClassifyTitlesResponse> {
    return this.search.classify(auth.userId, body.titles);
  }

  /** D-24: a IA acha os títulos numa descrição livre ou no texto de um print; o TMDB confirma */
  @Post('ai')
  @HttpCode(200)
  ai(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(AiFindTitlesRequestSchema)) body: AiFindTitlesRequest): Promise<AiFindTitlesResponse> {
    return this.search.aiFind(auth.userId, body);
  }
}

/** D-25: "O que assistir hoje?" — 5 sugestões da IA pelo seu perfil, sem o que você já assistiu. */
@Controller('tonight')
export class TonightController {
  constructor(private readonly tonight: TonightService) {}

  @Post()
  @HttpCode(200)
  suggest(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(TonightRequestSchema.optional())) body: TonightRequest | undefined): Promise<TonightResponse> {
    return this.tonight.tonight(auth.userId, body ?? {});
  }

  /** "Já assisti": grava como assistido e não sugere de novo */
  @Post('watched')
  @HttpCode(200)
  watched(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(TonightWatchedRequestSchema)) body: TonightWatchedRequest): Promise<Title> {
    return this.tonight.markWatched(auth.userId, body);
  }
}
