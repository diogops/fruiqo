import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CreateListRequest,
  CreateListRequestSchema,
  type DiscoverRequest,
  DiscoverRequestSchema,
  type DiscoverResponse,
  type EnrichResponse,
  type FeedbackRequest,
  FeedbackRequestSchema,
  type FeedbackResponse,
  type HomeResponse,
  type LibraryQuery,
  LibraryQuerySchema,
  type LibraryResponse,
  type ListDetail,
  type ListSummary,
  type ReorderListRequest,
  ReorderListRequestSchema,
  type Title,
  type UpdateTitleRequest,
  UpdateTitleRequestSchema,
} from '@fruiqo/contracts';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { EnrichmentService } from './enrichment.service.js';
import { LibraryService } from './library.service.js';

@Controller('library')
export class LibraryController {
  constructor(
    private readonly library: LibraryService,
    private readonly enrichment: EnrichmentService,
  ) {}

  @Get()
  list(@CurrentAuth() auth: AccessClaims, @Query(new ZodPipe(LibraryQuerySchema)) q: LibraryQuery): Promise<LibraryResponse> {
    return this.library.list(auth.userId, q);
  }

  @Get(':id')
  get(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<Title> {
    return this.library.get(auth.userId, id);
  }

  /** 409 `{error: 'conflict', conflictWith}` quando o novo título colide com outro item do usuário. */
  @Patch(':id')
  update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateTitleRequestSchema)) body: UpdateTitleRequest,
  ): Promise<Title> {
    return this.library.update(auth.userId, id, body);
  }

  /** 2d: enriquece o título no TMDB agora (gêneros, sinopse, pôster, onde assistir no BR). */
  @Post(':id/enrich')
  @HttpCode(200)
  async enrich(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<EnrichResponse> {
    const status = await this.enrichment.enrichOne(auth.userId, id);
    return { status, title: await this.library.get(auth.userId, id) };
  }
}

@Controller('lists')
export class ListsController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(@CurrentAuth() auth: AccessClaims): Promise<ListSummary[]> {
    return this.library.lists(auth.userId);
  }

  @Post()
  create(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(CreateListRequestSchema)) body: CreateListRequest): Promise<ListDetail> {
    return this.library.createList(auth.userId, body);
  }

  @Get(':id')
  get(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<ListDetail> {
    return this.library.getList(auth.userId, id);
  }

  @Put(':id/items')
  reorder(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReorderListRequestSchema)) body: ReorderListRequest,
  ): Promise<ListDetail> {
    return this.library.reorder(auth.userId, id, body.titleIds);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.library.deleteList(auth.userId, id);
  }
}

@Controller()
export class HomeController {
  constructor(private readonly library: LibraryService) {}

  @Get('home')
  home(@CurrentAuth() auth: AccessClaims): Promise<HomeResponse> {
    return this.library.home(auth.userId);
  }

  /** "Surpreenda-me" e "Como estou". O texto do humor não é persistido nem logado (RNF-06). */
  @Post('discover')
  @HttpCode(200)
  discover(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(DiscoverRequestSchema)) body: DiscoverRequest): Promise<DiscoverResponse> {
    return this.library.discover(auth.userId, body);
  }

  @Post('feedback')
  @HttpCode(200)
  feedback(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(FeedbackRequestSchema)) body: FeedbackRequest): Promise<FeedbackResponse> {
    return this.library.feedback(auth.userId, body);
  }
}
