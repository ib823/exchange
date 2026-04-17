import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SubmissionsService } from './submissions.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { createSubmissionSchema, type CreateSubmissionDto } from '@sep/schemas';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { PageSizePipe } from '../../common/pipes/page-size.pipe';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

function parseBody<T>(
  schema: {
    safeParse: (v: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: Array<{ path: (string | number)[]; message: string; code: string }> };
        };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    // Check if any issue is a payloadSize ceiling violation
    const payloadSizeIssue = result.error.issues.find(
      (i) => i.path.includes('payloadSize') && i.code === 'too_big',
    );
    if (payloadSizeIssue !== undefined) {
      throw new SepError(ErrorCode.VALIDATION_PAYLOAD_TOO_LARGE, {
        message: payloadSizeIssue.message,
        field: 'payloadSize',
      });
    }
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return result.data;
}

@ApiTags('Submissions')
@ApiBearerAuth()
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('TENANT_ADMIN', 'INTEGRATION_ENGINEER', 'OPERATIONS_ANALYST')
  @ApiOperation({ summary: 'Create a new submission' })
  @ApiResponse({ status: 202, description: 'Submission accepted' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Duplicate idempotency key' })
  async create(
    @Body() body: unknown,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: { submissionId: string; correlationId: string; status: string } }> {
    const cfg = getConfig();
    const schema = createSubmissionSchema(cfg.storage.maxPayloadSizeBytes);
    const dto = parseBody<CreateSubmissionDto>(schema, body);
    const result = await this.service.create(dto, req.user);
    return { data: result };
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
  @ApiOperation({ summary: 'List submissions' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'partnerProfileId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiResponse({ status: 200, description: 'Submission list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), PageSizePipe) pageSize: number,
    @Query('status') status: string | undefined,
    @Query('partnerProfileId') partnerProfileId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req?: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    if (req === undefined) {
      throw new SepError(ErrorCode.RBAC_INSUFFICIENT_ROLE, {
        message: 'Missing authentication context',
      });
    }
    return this.service.findAll(req.user, page, pageSize, { status, partnerProfileId, from, to });
  }

  @Get(':submissionId')
  @Roles(
    'PLATFORM_SUPER_ADMIN',
    'TENANT_ADMIN',
    'SECURITY_ADMIN',
    'INTEGRATION_ENGINEER',
    'OPERATIONS_ANALYST',
    'COMPLIANCE_REVIEWER',
  )
  @ApiOperation({ summary: 'Get submission by ID' })
  @ApiParam({ name: 'submissionId', type: String })
  @ApiResponse({ status: 200, description: 'Submission detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('submissionId') submissionId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const submission = await this.service.findById(submissionId, req.user);
    return { data: submission };
  }

  @Get(':submissionId/timeline')
  @Roles(
    'PLATFORM_SUPER_ADMIN',
    'TENANT_ADMIN',
    'SECURITY_ADMIN',
    'INTEGRATION_ENGINEER',
    'OPERATIONS_ANALYST',
    'COMPLIANCE_REVIEWER',
  )
  @ApiOperation({ summary: 'Get submission audit timeline' })
  @ApiParam({ name: 'submissionId', type: String })
  @ApiResponse({ status: 200, description: 'Submission timeline' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getTimeline(
    @Param('submissionId') submissionId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    return this.service.getTimeline(submissionId, req.user);
  }

  @Post(':submissionId/cancel')
  @HttpCode(200)
  @Roles('OPERATIONS_ANALYST', 'TENANT_ADMIN')
  @ApiOperation({ summary: 'Cancel a submission' })
  @ApiParam({ name: 'submissionId', type: String })
  @ApiResponse({ status: 200, description: 'Submission cancelled' })
  @ApiResponse({ status: 400, description: 'Submission in terminal state' })
  async cancel(
    @Param('submissionId') submissionId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const submission = await this.service.cancel(submissionId, req.user);
    return { data: submission };
  }
}
