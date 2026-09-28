import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  type CreateShareRequest,
  CreateShareRequestSchema,
  type Share,
  type ShareListResponse,
  type ShareStepsResponse,
} from '@fruiqo/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ENV, type Env } from '../config/env.js';
import { SharesService } from './shares.service.js';

const CursorSchema = z.string().max(200).optional();
const FixtureIdSchema = /^[a-z0-9][a-z0-9-]{0,63}$/;

@Controller('shares')
export class SharesController {
  constructor(
    private readonly shares: SharesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** 201 quando cria; 200 quando é retry do mesmo clientShareId. */
  @Post()
  async create(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodPipe(CreateShareRequestSchema)) body: CreateShareRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-fruiqo-fixture') fixtureHeader?: string,
  ): Promise<Share> {
    // RF-18/19: marca share de fixture só com o sandbox ligado e fora de produção (env já garante)
    const fixture =
      this.env.SANDBOX_ENABLED && this.env.NODE_ENV !== 'production' && fixtureHeader && FixtureIdSchema.test(fixtureHeader)
        ? fixtureHeader
        : undefined;
    const { share, created } = await this.shares.create(auth.userId, body, fixture);
    res.status(created ? 201 : 200);
    return share;
  }

  @Get()
  list(
    @CurrentAuth() auth: AccessClaims,
    @Query('cursor', new ZodPipe(CursorSchema)) cursor: string | undefined,
  ): Promise<ShareListResponse> {
    return this.shares.list(auth.userId, cursor);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Share> {
    return this.shares.get(auth.userId, id);
  }

  @Get(':id/steps')
  steps(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ShareStepsResponse> {
    return this.shares.steps(auth.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.shares.remove(auth.userId, id);
  }
}
