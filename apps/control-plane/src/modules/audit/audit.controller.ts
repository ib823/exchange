import { Controller, Get, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditSearchSchema } from '@sep/schemas';
import { SepError, ErrorCode } from '@sep/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'Search audit events — immutable, read-only' })
  @ApiResponse({ status: 200, description: 'Audit events' })
  async search(
    @Query() query: unknown,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const result = AuditSearchSchema.safeParse(query);
    if (!result.success) {
      throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const dto = result.data;
    const searchParams: Parameters<AuditService['search']>[0] = {
      tenantId: req.user.tenantId,
      page: dto.page,
      pageSize: dto.pageSize,
    };
    if (dto.objectType !== undefined) { searchParams.objectType = dto.objectType; }
    if (dto.objectId !== undefined) { searchParams.objectId = dto.objectId; }
    if (dto.action !== undefined) { searchParams.action = dto.action; }
    if (dto.actorId !== undefined) { searchParams.actorId = dto.actorId; }
    if (dto.correlationId !== undefined) { searchParams.correlationId = dto.correlationId; }
    if (dto.from !== undefined) { searchParams.from = new Date(dto.from); }
    if (dto.to !== undefined) { searchParams.to = new Date(dto.to); }
    return this.auditService.search(searchParams);
  }
}
