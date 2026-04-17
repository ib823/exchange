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
import { CreateKeyReferenceSchema } from '@sep/schemas';
import { KeyReferencesService } from './key-references.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { SepError, ErrorCode } from '@sep/common';
import { PageSizePipe } from '../../common/pipes/page-size.pipe';
import type { TokenPayload } from '../auth/auth.service';
import type { FastifyRequest } from 'fastify';

class CreateKeyReferenceDto extends createZodDto(CreateKeyReferenceSchema) {}

@ApiTags('Key References')
@ApiBearerAuth()
@Controller('key-references')
export class KeyReferencesController {
  constructor(private readonly service: KeyReferencesService) {}

  @Post()
  @Roles('SECURITY_ADMIN')
  @ApiOperation({ summary: 'Create a new key reference' })
  @ApiResponse({ status: 201, description: 'Key reference created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreateKeyReferenceDto,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const keyRef = await this.service.create(dto, req.user);
    return { data: keyRef };
  }

  @Get()
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'List key references' })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'environment', required: false })
  @ApiResponse({ status: 200, description: 'Key reference list' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), PageSizePipe) pageSize: number,
    @Query('state') state: string | undefined,
    @Query('environment') environment: string | undefined,
    @Request() req?: FastifyRequest & { user: TokenPayload },
  ): Promise<unknown> {
    if (req === undefined) {
      throw new SepError(ErrorCode.RBAC_INSUFFICIENT_ROLE, {
        message: 'Missing authentication context',
      });
    }
    return this.service.findAll(req.user, page, pageSize, { state, environment });
  }

  @Get(':keyId')
  @Roles('SECURITY_ADMIN', 'TENANT_ADMIN', 'COMPLIANCE_REVIEWER')
  @ApiOperation({ summary: 'Get key reference by ID' })
  @ApiParam({ name: 'keyId', type: String })
  @ApiResponse({ status: 200, description: 'Key reference detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('keyId') keyId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const keyRef = await this.service.findById(keyId, req.user);
    return { data: keyRef };
  }

  @Post(':keyId/activate')
  @HttpCode(200)
  @Roles('SECURITY_ADMIN')
  @ApiOperation({ summary: 'Activate a key reference' })
  @ApiParam({ name: 'keyId', type: String })
  @ApiResponse({ status: 200, description: 'Key activated' })
  @ApiResponse({ status: 400, description: 'Invalid state for activation' })
  async activate(
    @Param('keyId') keyId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const keyRef = await this.service.activate(keyId, req.user);
    return { data: keyRef };
  }

  @Post(':keyId/revoke')
  @HttpCode(200)
  @Roles('SECURITY_ADMIN')
  @ApiOperation({ summary: 'Revoke a key reference' })
  @ApiParam({ name: 'keyId', type: String })
  @ApiResponse({ status: 200, description: 'Key revoked' })
  @ApiResponse({ status: 400, description: 'Invalid state for revocation' })
  async revoke(
    @Param('keyId') keyId: string,
    @Request() req: FastifyRequest & { user: TokenPayload },
  ): Promise<{ data: unknown }> {
    const keyRef = await this.service.revoke(keyId, req.user);
    return { data: keyRef };
  }
}
