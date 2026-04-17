import {
  Controller, Get, Post, Patch, Body, Param, Query,
  DefaultValuePipe, ParseIntPipe, Request, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CreateWebhookSchema } from '@sep/schemas';
import { WebhooksService } from './webhooks.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageSizePipe } from '../../common/pipes/page-size.pipe';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

class CreateWebhookDto extends createZodDto(CreateWebhookSchema) {}

@ApiTags('Webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER')
  @ApiOperation({ summary: 'Register a new webhook' })
  @ApiResponse({ status: 201, description: 'Webhook registered' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreateWebhookDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const webhook = await this.service.create(dto, req.user);
    return { data: webhook };
  }

  @Get()
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER', 'OPERATIONS_ANALYST')
  @ApiOperation({ summary: 'List webhooks' })
  @ApiResponse({ status: 200, description: 'Webhook list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), PageSizePipe) pageSize: number,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    return this.service.findAll(req.user, page, pageSize);
  }

  @Get(':webhookId')
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER', 'OPERATIONS_ANALYST')
  @ApiOperation({ summary: 'Get webhook by ID' })
  @ApiParam({ name: 'webhookId', type: String })
  @ApiResponse({ status: 200, description: 'Webhook detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('webhookId') webhookId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const webhook = await this.service.findById(webhookId, req.user);
    return { data: webhook };
  }

  @Patch(':webhookId/deactivate')
  @HttpCode(200)
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Deactivate a webhook' })
  @ApiParam({ name: 'webhookId', type: String })
  @ApiResponse({ status: 200, description: 'Webhook deactivated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deactivate(
    @Param('webhookId') webhookId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const webhook = await this.service.deactivate(webhookId, req.user);
    return { data: webhook };
  }
}
