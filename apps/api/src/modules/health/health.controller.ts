import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';

/**
 * Liveness and readiness.
 *
 * `/health` answers "is this process up" and is what the platform polls.
 * `/health/ready` actually touches the database, so a container with a broken
 * connection string is taken out of rotation rather than serving 500s.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — verifies dependencies' })
  async ready() {
    const checks: Record<string, 'ok' | 'error'> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    checks.mail = (await this.mail.verify()) ? 'ok' : 'error';

    // Mail being down degrades digests but does not stop the app working, so it
    // is reported without failing readiness.
    const healthy = checks.database === 'ok';
    return { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }
}
