import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { reportQuerySchema, reportSchema, type ReportDto, type ReportQueryDto } from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('portfolio')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Full management report — KPIs, breakdowns, alerts, status sheet' })
  portfolio(
    @CurrentUser('organisationId') organisationId: string,
    @Query(zodQuery(reportQuerySchema)) query: ReportQueryDto,
  ) {
    return this.reports.build(organisationId, query);
  }

  @Patch('portfolio')
  @RequirePermissions('report:write')
  @ApiOperation({ summary: 'Save the report title and management commentary' })
  save(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(reportSchema)) dto: ReportDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.reports.saveMeta(actor, dto, client);
  }
}
