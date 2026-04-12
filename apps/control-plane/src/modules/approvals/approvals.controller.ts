import {
  Controller, Get, Post, Body, Param, Query,
  DefaultValuePipe, ParseIntPipe, Request, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam,
} from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

@ApiTags('Approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  @Get()
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'List pending approvals' })
  @ApiResponse({ status: 200, description: 'Pending approval list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    return this.service.findPending(req.user, page, pageSize);
  }

  @Get(':approvalId')
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'Get approval by ID' })
  @ApiParam({ name: 'approvalId', type: String })
  @ApiResponse({ status: 200, description: 'Approval detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('approvalId') approvalId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const approval = await this.service.findById(approvalId, req.user);
    return { data: approval };
  }

  @Post(':approvalId/approve')
  @HttpCode(200)
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Approve an approval request' })
  @ApiParam({ name: 'approvalId', type: String })
  @ApiResponse({ status: 200, description: 'Approval granted' })
  @ApiResponse({ status: 400, description: 'Invalid state or self-approval' })
  async approve(
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const { notes } = (body ?? {}) as { notes?: string };
    const approval = await this.service.approve(approvalId, req.user, notes);
    return { data: approval };
  }

  @Post(':approvalId/reject')
  @HttpCode(200)
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Reject an approval request' })
  @ApiParam({ name: 'approvalId', type: String })
  @ApiResponse({ status: 200, description: 'Approval rejected' })
  @ApiResponse({ status: 400, description: 'Invalid state' })
  async reject(
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const { notes } = (body ?? {}) as { notes?: string };
    const approval = await this.service.reject(approvalId, req.user, notes);
    return { data: approval };
  }
}
