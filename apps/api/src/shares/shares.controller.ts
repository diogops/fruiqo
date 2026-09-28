import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
} from '@fruiqo/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { SharesService } from './shares.service.js';

const CursorSchema = z.string().max(200).optional();

@Controller('shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  /** 201 quando cria; 200 quando é retry do mesmo clientShareId. */
  @Post()
  async create(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodPipe(CreateShareRequestSchema)) body: CreateShareRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Share> {
    const { share, created } = await this.shares.create(auth.userId, body);
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

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.shares.remove(auth.userId, id);
  }
}
