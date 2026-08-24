import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { reportQuerySchema, type ReportQueryDto } from '@ciq/shared';
import { CurrentUser, RequirePermissions } from '../../common/auth-context';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { ExportsService, type ExportFile } from './exports.service';

@ApiTags('Reports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('portfolio.xlsx')
  @RequirePermissions('report:export')
  @ApiOperation({ summary: 'Portfolio workbook — summary, status, procurement, category, phase' })
  async portfolioXlsx(
    @CurrentUser('organisationId') organisationId: string,
    @Query(zodQuery(reportQuerySchema)) query: ReportQueryDto,
    @Res() res: Response,
  ) {
    send(res, await this.exports.portfolioWorkbook(organisationId, query));
  }

  @Get('portfolio.pdf')
  @RequirePermissions('report:export')
  @ApiOperation({ summary: 'Portfolio report as a paginated PDF pack' })
  async portfolioPdf(
    @CurrentUser('organisationId') organisationId: string,
    @Query(zodQuery(reportQuerySchema)) query: ReportQueryDto,
    @Res() res: Response,
  ) {
    send(res, await this.exports.portfolioPdf(organisationId, query));
  }

  @Get('projects/:id.xlsx')
  @RequirePermissions('report:export')
  @ApiOperation({ summary: 'One project — overview, drawings, materials, execution' })
  async projectXlsx(
    @CurrentUser('organisationId') organisationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    send(res, await this.exports.projectWorkbook(organisationId, id));
  }
}

/**
 * Streams a generated file back.
 *
 * `Content-Disposition` carries the filename; quotes are stripped from it because
 * an unescaped quote in a project name would truncate the header and hand the
 * browser a file called something unexpected.
 */
function send(res: Response, file: ExportFile): void {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.fileName.replace(/["\r\n]/g, '')}"`,
  );
  res.setHeader('Content-Length', file.buffer.length);
  res.end(file.buffer);
}
