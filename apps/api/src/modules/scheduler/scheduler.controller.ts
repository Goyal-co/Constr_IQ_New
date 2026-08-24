import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/auth-context';
import { SchedulerService } from './scheduler.service';

/**
 * Manual triggers for the scheduled jobs.
 *
 * Restricted to org administrators. Useful for verifying a digest template
 * without waiting a week, and for re-running a sweep after fixing data — both
 * jobs are idempotent, so triggering one twice is harmless.
 */
@ApiTags('Admin')
@Controller('admin/jobs')
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Post('risk-sweep')
  @HttpCode(200)
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Run the risk sweep now' })
  riskSweep() {
    return this.scheduler.runRiskSweep();
  }

  @Post('digest')
  @HttpCode(200)
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Send the portfolio digest now, ignoring the configured day' })
  digest() {
    return this.scheduler.runWeeklyDigest(true);
  }
}
