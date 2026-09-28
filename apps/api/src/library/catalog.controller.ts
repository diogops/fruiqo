import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type ActivityResponse,
  type BulkRequest,
  BulkRequestSchema,
  type BulkResponse,
  type BulkUndoRequest,
  BulkUndoRequestSchema,
  type BulkUndoResponse,
  type CorrectTitleRequest,
  CorrectTitleRequestSchema,
  type CreateTitleRequest,
  CreateTitleRequestSchema,
  type DuplicateListRequest,
  DuplicateListRequestSchema,
  type ListDetail,
  type MergeTitleRequest,
  MergeTitleRequestSchema,
  type MoodHistoryResponse,
  type ReviewListResponse,
  type ReviewRematchRequest,
  ReviewRematchRequestSchema,
  type SandboxEvalsResponse,
  type SandboxFixturesResponse,
  type SandboxRunResponse,
  type SubscriptionsResponse,
  type TasteProfile,
  type Title,
  type UpdateListRequest,
  UpdateListRequestSchema,
  type UpdateSubscriptionsRequest,
  UpdateSubscriptionsRequestSchema,
  type UpdateTasteRequest,
  UpdateTasteRequestSchema,
  type UpdateUserSettingsRequest,
  UpdateUserSettingsRequestSchema,
  type UserSettings,
} from '@fruiqo/contracts';
import { z } from 'zod';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { SandboxService } from '../sandbox/sandbox.service.js';
import { CatalogService } from './catalog.service.js';

const CursorSchema = z.string().max(200).optional();
const FixtureIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** Fase 2c (sistema web). Rotas estáticas (`bulk`, `bulk/undo`) ficam antes de `:id`. */
@Controller('library')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post()
  create(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(CreateTitleRequestSchema)) body: CreateTitleRequest): Promise<Title> {
    return this.catalog.createTitle(auth.userId, body);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(BulkRequestSchema)) body: BulkRequest): Promise<BulkResponse> {
    return this.catalog.bulk(auth.userId, body);
  }

  @Post('bulk/undo')
  @HttpCode(200)
  undo(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(BulkUndoRequestSchema)) body: BulkUndoRequest): Promise<BulkUndoResponse> {
    return this.catalog.undo(auth.userId, body.undoToken);
  }

  /** RF-27: corrigir o match; 409 com `suggestion: 'merge'` se colidir com outro título. */
  @Post(':id/correct')
  @HttpCode(200)
  correct(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CorrectTitleRequestSchema)) body: CorrectTitleRequest,
  ): Promise<Title> {
    return this.catalog.correct(auth.userId, id, body);
  }

  @Post(':id/merge')
  @HttpCode(200)
  merge(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(MergeTitleRequestSchema)) body: MergeTitleRequest,
  ): Promise<Title> {
    return this.catalog.merge(auth.userId, id, body.intoId);
  }
}

@Controller('lists')
export class ListsAdminController {
  constructor(private readonly catalog: CatalogService) {}

  @Patch(':id')
  update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateListRequestSchema)) body: UpdateListRequest,
  ): Promise<ListDetail> {
    return this.catalog.updateList(auth.userId, id, body);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DuplicateListRequestSchema)) body: DuplicateListRequest,
  ): Promise<ListDetail> {
    return this.catalog.duplicateList(auth.userId, id, body.name);
  }
}

@Controller('review')
export class ReviewController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@CurrentAuth() auth: AccessClaims): Promise<ReviewListResponse> {
    return this.catalog.reviewQueue(auth.userId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<Title> {
    return this.catalog.approve(auth.userId, id);
  }

  @Post(':id/reject')
  @HttpCode(204)
  reject(@CurrentAuth() auth: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.catalog.reject(auth.userId, id);
  }

  @Post(':id/rematch')
  @HttpCode(200)
  rematch(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReviewRematchRequestSchema)) body: ReviewRematchRequest,
  ): Promise<Title> {
    return this.catalog.rematch(auth.userId, id, body);
  }
}

@Controller()
export class ProfileController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('activity')
  activity(@CurrentAuth() auth: AccessClaims, @Query('cursor', new ZodPipe(CursorSchema)) cursor: string | undefined): Promise<ActivityResponse> {
    return this.catalog.activity(auth.userId, cursor);
  }

  @Get('profile/taste')
  taste(@CurrentAuth() auth: AccessClaims): Promise<TasteProfile> {
    return this.catalog.taste(auth.userId);
  }

  @Patch('profile/taste')
  updateTaste(@CurrentAuth() auth: AccessClaims, @Body(new ZodPipe(UpdateTasteRequestSchema)) body: UpdateTasteRequest): Promise<TasteProfile> {
    return this.catalog.updateTaste(auth.userId, body);
  }

  @Get('profile/subscriptions')
  subscriptions(@CurrentAuth() auth: AccessClaims): Promise<SubscriptionsResponse> {
    return this.catalog.subscriptions(auth.userId);
  }

  @Put('profile/subscriptions')
  setSubscriptions(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodPipe(UpdateSubscriptionsRequestSchema)) body: UpdateSubscriptionsRequest,
  ): Promise<SubscriptionsResponse> {
    return this.catalog.setSubscriptions(auth.userId, body.providers);
  }

  @Get('profile/settings')
  settings(@CurrentAuth() auth: AccessClaims): Promise<UserSettings> {
    return this.catalog.getSettings(auth.userId);
  }

  @Patch('profile/settings')
  updateSettings(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodPipe(UpdateUserSettingsRequestSchema)) body: UpdateUserSettingsRequest,
  ): Promise<UserSettings> {
    return this.catalog.updateSettings(auth.userId, body);
  }

  @Get('profile/mood-history')
  moodHistory(@CurrentAuth() auth: AccessClaims): Promise<MoodHistoryResponse> {
    return this.catalog.moodHistory(auth.userId);
  }

  @Delete('profile/mood-history')
  @HttpCode(204)
  deleteMoodHistory(@CurrentAuth() auth: AccessClaims): Promise<void> {
    return this.catalog.deleteMoodHistory(auth.userId);
  }
}

/** RF-19/RF-22: só com SANDBOX_ENABLED e fora de produção (senão 404). */
@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Get('fixtures')
  fixtures(@CurrentAuth() _auth: AccessClaims): SandboxFixturesResponse {
    return this.sandbox.fixtures();
  }

  @Post('fixtures/:id/run')
  @HttpCode(200)
  run(@CurrentAuth() _auth: AccessClaims, @Param('id', new ZodPipe(FixtureIdSchema)) id: string): Promise<SandboxRunResponse> {
    return this.sandbox.run(id);
  }

  @Get('evals')
  evals(@CurrentAuth() _auth: AccessClaims): SandboxEvalsResponse {
    return this.sandbox.evals();
  }
}
