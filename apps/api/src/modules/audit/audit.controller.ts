import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditQueryDto } from '@ciq/shared';
import { CurrentUser, RequirePermissions } from '../../common/auth-context';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Search the organisation audit trail' })
  list(
    @CurrentUser('organisationId') organisationId: string,
    @Query(zodQuery(auditQuerySchema)) query: AuditQueryDto,
  ) {
    return this.audit.query(organisationId, query);
  }
}
