import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CreateTenantSchema, UpdateTenantSchema } from '@sep/schemas';
import { TenantsService } from './tenants.service';
import { Roles, SkipTenantCheck } from '../../common/decorators/roles.decorator';
import { PageSizePipe } from '../../common/pipes/page-size.pipe';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

class CreateTenantDto extends createZodDto(CreateTenantSchema) {}
class UpdateTenantDto extends createZodDto(UpdateTenantSchema) {}

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
    @Body() dto: CreateTenantDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
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
    @Query('pageSize', new DefaultValuePipe(20), PageSizePipe) pageSize: number,
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
    @Body() dto: UpdateTenantDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
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
