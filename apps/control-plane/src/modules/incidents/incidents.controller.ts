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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CreateIncidentSchema, UpdateIncidentSchema } from '@sep/schemas';
import { IncidentsService } from './incidents.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { SepError, ErrorCode } from '@sep/common';
import { PageSizePipe } from '../../common/pipes/page-size.pipe';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

class CreateIncidentDto extends createZodDto(CreateIncidentSchema) {}
class UpdateIncidentDto extends createZodDto(UpdateIncidentSchema) {}

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Post()
  @Roles('OPERATIONS_ANALYST', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Create a new incident' })
  @ApiResponse({ status: 201, description: 'Incident created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreateIncidentDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const incident = await this.service.create(
      {
        tenantId: dto.tenantId,
        severity: dto.severity,
        title: dto.title,
        description: dto.description,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        assignedTo: dto.assignedTo,
      },
      req.user,
    );
    return { data: incident };
  }

  @Get()
  @Roles(
    'PLATFORM_SUPER_ADMIN',
    'TENANT_ADMIN',
    'SECURITY_ADMIN',
    'INTEGRATION_ENGINEER',
    'OPERATIONS_ANALYST',
    'COMPLIANCE_REVIEWER',
  )
  @ApiOperation({ summary: 'List incidents' })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiResponse({ status: 200, description: 'Incident list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), PageSizePipe) pageSize: number,
    @Query('state') state: string | undefined,
    @Query('severity') severity: string | undefined,
    @Request() req?: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    if (req === undefined) {
      throw new SepError(ErrorCode.RBAC_INSUFFICIENT_ROLE, {
        message: 'Missing authentication context',
      });
    }
    return this.service.findAll(req.user, page, pageSize, { state, severity });
  }

  @Get(':incidentId')
  @Roles(
    'PLATFORM_SUPER_ADMIN',
    'TENANT_ADMIN',
    'SECURITY_ADMIN',
    'INTEGRATION_ENGINEER',
    'OPERATIONS_ANALYST',
    'COMPLIANCE_REVIEWER',
  )
  @ApiOperation({ summary: 'Get incident by ID' })
  @ApiParam({ name: 'incidentId', type: String })
  @ApiResponse({ status: 200, description: 'Incident detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('incidentId') incidentId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const incident = await this.service.findById(incidentId, req.user);
    return { data: incident };
  }

  @Patch(':incidentId')
  @Roles('OPERATIONS_ANALYST', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Update incident (triage, assign, resolve)' })
  @ApiParam({ name: 'incidentId', type: String })
  @ApiResponse({ status: 200, description: 'Incident updated' })
  @ApiResponse({ status: 400, description: 'Validation error or invalid transition' })
  async update(
    @Param('incidentId') incidentId: string,
    @Body() dto: UpdateIncidentDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const incident = await this.service.update(
      incidentId,
      {
        severity: dto.severity,
        title: dto.title,
        description: dto.description,
        assignedTo: dto.assignedTo,
        state: dto.state,
        resolution: dto.resolution,
      },
      req.user,
    );
    return { data: incident };
  }
}
