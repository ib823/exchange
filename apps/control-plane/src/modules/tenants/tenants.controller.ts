import {
  Controller, Get, Post, Patch, Body, Param, Query,
  DefaultValuePipe, ParseIntPipe, Request,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam,
} from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { Roles, SkipTenantCheck } from '../../common/decorators/roles.decorator';
import { CreateTenantSchema, UpdateTenantSchema, type CreateTenantDto, type UpdateTenantDto } from '@sep/schemas';
import { SepError, ErrorCode } from '@sep/common';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

function parseBody<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return result.data;
}

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @Roles('PLATFORM_SUPER_ADMIN')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Create a new tenant' })
  @ApiResponse({ status: 201, description: 'Tenant created' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async create(
    @Body() body: unknown,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const dto = parseBody<CreateTenantDto>(CreateTenantSchema, body);
    const tenant = await this.tenantsService.create(dto, req.user);
    return { data: tenant };
  }

  @Get()
  @Roles('PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'List tenants' })
  @ApiResponse({ status: 200, description: 'Tenant list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    return this.tenantsService.findAll(req.user, page, pageSize);
  }

  @Get(':tenantId')
  @Roles('PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'SECURITY_ADMIN', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'Get tenant by ID' })
  @ApiParam({ name: 'tenantId', type: String })
  @ApiResponse({ status: 200, description: 'Tenant detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('tenantId') tenantId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const tenant = await this.tenantsService.findById(tenantId, req.user);
    return { data: tenant };
  }

  @Patch(':tenantId')
  @Roles('PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Update tenant' })
  @ApiParam({ name: 'tenantId', type: String })
  @ApiResponse({ status: 200, description: 'Tenant updated' })
  async update(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const dto = parseBody<UpdateTenantDto>(UpdateTenantSchema, body);
    const tenant = await this.tenantsService.update(tenantId, dto, req.user);
    return { data: tenant };
  }

  @Post(':tenantId/suspend')
  @Roles('PLATFORM_SUPER_ADMIN')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Suspend tenant' })
  @ApiParam({ name: 'tenantId', type: String })
  @ApiResponse({ status: 200, description: 'Tenant suspended' })
  async suspend(
    @Param('tenantId') tenantId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const tenant = await this.tenantsService.suspend(tenantId, req.user);
    return { data: tenant };
  }
}
