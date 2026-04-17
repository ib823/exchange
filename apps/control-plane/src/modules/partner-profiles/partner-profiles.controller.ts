import {
  Controller, Get, Post, Patch, Body, Param, Query,
  DefaultValuePipe, ParseIntPipe, Request, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  CreatePartnerProfileSchema,
  UpdatePartnerProfileSchema,
  TransitionPartnerProfileSchema,
} from '@sep/schemas';
import { PartnerProfilesService } from './partner-profiles.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { SepError, ErrorCode } from '@sep/common';
import { PageSizePipe } from '../../common/pipes/page-size.pipe';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

class CreatePartnerProfileDto extends createZodDto(CreatePartnerProfileSchema) {}
class UpdatePartnerProfileDto extends createZodDto(UpdatePartnerProfileSchema) {}
class TransitionPartnerProfileDto extends createZodDto(TransitionPartnerProfileSchema) {}

@ApiTags('Partner Profiles')
@ApiBearerAuth()
@Controller('partner-profiles')
export class PartnerProfilesController {
  constructor(private readonly service: PartnerProfilesService) {}

  @Post()
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER')
  @ApiOperation({ summary: 'Create a new partner profile' })
  @ApiResponse({ status: 201, description: 'Partner profile created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreatePartnerProfileDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const profile = await this.service.create(dto, req.user);
    return { data: profile };
  }

  @Get()
  @Roles('PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'SECURITY_ADMIN', 'INTEGRATION_ENGINEER', 'OPERATIONS_ANALYST', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'List partner profiles' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'environment', required: false })
  @ApiResponse({ status: 200, description: 'Partner profile list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), PageSizePipe) pageSize: number,
    @Query('status') status: string | undefined,
    @Query('environment') environment: string | undefined,
    @Request() req?: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    if (req === undefined) {
      throw new SepError(ErrorCode.RBAC_INSUFFICIENT_ROLE, { message: 'Missing authentication context' });
    }
    return this.service.findAll(req.user, page, pageSize, { status, environment });
  }

  @Get(':profileId')
  @Roles('PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'SECURITY_ADMIN', 'INTEGRATION_ENGINEER', 'OPERATIONS_ANALYST', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'Get partner profile by ID' })
  @ApiParam({ name: 'profileId', type: String })
  @ApiResponse({ status: 200, description: 'Partner profile detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('profileId') profileId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const profile = await this.service.findById(profileId, req.user);
    return { data: profile };
  }

  @Patch(':profileId')
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER')
  @ApiOperation({ summary: 'Update partner profile (DRAFT only)' })
  @ApiParam({ name: 'profileId', type: String })
  @ApiResponse({ status: 200, description: 'Partner profile updated' })
  @ApiResponse({ status: 400, description: 'Validation error or not in DRAFT status' })
  async update(
    @Param('profileId') profileId: string,
    @Body() dto: UpdatePartnerProfileDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const profile = await this.service.update(profileId, dto, req.user);
    return { data: profile };
  }

  @Post(':profileId/transition')
  @HttpCode(200)
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER', 'SECURITY_ADMIN')
  @ApiOperation({ summary: 'Transition partner profile status' })
  @ApiParam({ name: 'profileId', type: String })
  @ApiResponse({ status: 200, description: 'Status transitioned' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  async transition(
    @Param('profileId') profileId: string,
    @Body() dto: TransitionPartnerProfileDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const profile = await this.service.transition(profileId, dto.targetStatus, req.user);
    return { data: profile };
  }

  @Post(':profileId/suspend')
  @HttpCode(200)
  @Roles('TENANT_ADMIN', 'SECURITY_ADMIN')
  @ApiOperation({ summary: 'Suspend partner profile' })
  @ApiParam({ name: 'profileId', type: String })
  @ApiResponse({ status: 200, description: 'Profile suspended' })
  async suspend(
    @Param('profileId') profileId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const profile = await this.service.suspend(profileId, req.user);
    return { data: profile };
  }

  @Post(':profileId/retire')
  @HttpCode(200)
  @Roles('TENANT_ADMIN', 'SECURITY_ADMIN')
  @ApiOperation({ summary: 'Retire partner profile' })
  @ApiParam({ name: 'profileId', type: String })
  @ApiResponse({ status: 200, description: 'Profile retired' })
  async retire(
    @Param('profileId') profileId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const profile = await this.service.retire(profileId, req.user);
    return { data: profile };
  }
}
