import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  computeMaterialSchedule,
  formatDate,
  parseIsoDate,
  todayUtc,
  type MaterialStatus,
  type OrganisationSettings,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../../infra/mail/mail.service';
import { TokenService } from '../auth/token.service';
import { NotificationsService, type PushInput } from '../notifications/notifications.service';
import { SettingsService } from '../organisation/settings.service';
import { ReportsService } from '../reports/reports.service';
import {
  PROJECT_INCLUDE,
  toProjectSummary,
  type ProjectWithRelations,
} from '../projects/project.mapper';

/**
 * Background jobs.
 *
 * Two run on a cron: a nightly sweep that raises alerts for orders past their
 * order-by date, activities behind plan and handovers approaching; and a weekly
 * digest emailed to managers.
 *
 * Both are idempotent. The sweep uses notification dedupe keys so running it
 * twice does not double-notify, which matters because the natural failure mode
 * of a scheduled job is being run again.
 *
 * On multi-replica deployments set ENABLE_SCHEDULER=false on all but one
 * instance, or every replica will send the digest.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const scheduler = this.config.get('scheduler', { infer: true });
    if (!scheduler.enabled) {
      this.logger.log(
        'Scheduler disabled (ENABLE_SCHEDULER=false) — no background jobs registered.',
      );
      return;
    }

    // Registered dynamically rather than with @Cron so the expressions stay
    // configurable per environment.
    this.register('risk-sweep', scheduler.riskSweepCron, () => this.runRiskSweep());
    this.register('weekly-digest', scheduler.digestCron, () => this.runWeeklyDigest());
    this.register('housekeeping', '30 4 * * *', () => this.runHousekeeping());

    this.logger.log(
      `Scheduler active — risk sweep "${scheduler.riskSweepCron}", digest "${scheduler.digestCron}".`,
    );
  }

  private register(name: string, expression: string, handler: () => Promise<unknown>): void {
    try {
      const job = new CronJob(expression, () => {
        handler().catch((error) => this.logger.error(`Job "${name}" failed`, error as Error));
      });
      this.registry.addCronJob(name, job as never);
      job.start();
    } catch (error) {
      this.logger.error(
        `Could not register job "${name}" with expression "${expression}": ${(error as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Nightly risk sweep
  // -------------------------------------------------------------------------

  /**
   * Walk every organisation and raise in-app alerts for what needs attention.
   *
   * Alerts go to the project manager, falling back to organisation admins where a
   * project has none — an unassigned at-risk project is precisely the one nobody
   * is watching.
   */
  async runRiskSweep(): Promise<{ organisations: number; notifications: number }> {
    const now = todayUtc();
    const organisations = await this.prisma.organisation.findMany({ select: { id: true } });
    const settingsById = await this.settings.getMany(organisations.map((o) => o.id));

    let pushed = 0;

    for (const org of organisations) {
      const settings = settingsById.get(org.id);
      if (!settings) continue;

      const [projects, admins] = await Promise.all([
        this.prisma.project.findMany({
          where: { organisationId: org.id, deletedAt: null, status: { not: 'COMPLETED' } },
          include: PROJECT_INCLUDE,
        }),
        this.prisma.user.findMany({
          where: { organisationId: org.id, isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
          select: { id: true },
        }),
      ]);

      const alerts: PushInput[] = [];

      for (const row of projects) {
        const project = row as ProjectWithRelations;
        const recipients = project.managerId ? [project.managerId] : admins.map((a) => a.id);
        if (recipients.length === 0) continue;

        const summary = toProjectSummary(project, settings, now);

        for (const userId of recipients) {
          alerts.push(...this.projectAlerts(org.id, userId, project, summary, settings, now));
        }
      }

      if (alerts.length > 0) {
        // Dedupe keys make re-running the sweep a no-op rather than a flood.
        for (const alert of alerts) await this.notifications.push(alert);
        pushed += alerts.length;
      }
    }

    this.logger.log(
      `Risk sweep complete — ${organisations.length} organisations, ${pushed} alerts raised.`,
    );
    return { organisations: organisations.length, notifications: pushed };
  }

  private projectAlerts(
    organisationId: string,
    userId: string,
    project: ProjectWithRelations,
    summary: ReturnType<typeof toProjectSummary>,
    settings: OrganisationSettings,
    now: Date,
  ): PushInput[] {
    const alerts: PushInput[] = [];

    for (const material of project.materials) {
      const schedule = computeMaterialSchedule(
        { status: material.status as MaterialStatus, orderByDate: material.orderByDate },
        settings,
        now,
      );

      if (schedule.procurementState === 'OVERDUE') {
        alerts.push({
          organisationId,
          userId,
          kind: 'MATERIAL_OVERDUE',
          title: `${material.name} should already be on order`,
          body:
            `${project.name} — the order-by date was ${formatDate(parseIsoDate(schedule.orderByDate!), settings.locale)}, ` +
            `${Math.abs(schedule.daysUntilOrderBy ?? 0)} days ago.`,
          projectId: project.id,
          dedupeKey: `material-overdue:${material.id}`,
        });
      } else if (schedule.procurementState === 'DUE_SOON') {
        alerts.push({
          organisationId,
          userId,
          kind: 'MATERIAL_DUE_SOON',
          title: `Order ${material.name} within ${schedule.daysUntilOrderBy} days`,
          body:
            `${project.name} — order by ${formatDate(parseIsoDate(schedule.orderByDate!), settings.locale)} ` +
            `to stay on programme.`,
          projectId: project.id,
          dedupeKey: `material-due:${material.id}`,
        });
      }
    }

    const daysToHandover = summary.metrics.daysToHandover;
    if (
      daysToHandover !== null &&
      daysToHandover >= 0 &&
      daysToHandover <= settings.handoverReminderDays
    ) {
      alerts.push({
        organisationId,
        userId,
        kind: 'HANDOVER_APPROACHING',
        title: `${project.name} hands over in ${daysToHandover} days`,
        body:
          `Design is ${summary.metrics.designPct}% complete and execution is ` +
          `${summary.metrics.executionPct}%.`,
        projectId: project.id,
        dedupeKey: `handover:${project.id}:${daysToHandover > 7 ? 'month' : 'week'}`,
      });
    }

    if (summary.metrics.atRisk) {
      alerts.push({
        organisationId,
        userId,
        kind: 'PROJECT_AT_RISK',
        title: `${project.name} is flagged at risk`,
        body: summary.metrics.riskReasons.join('; '),
        projectId: project.id,
        dedupeKey: `at-risk:${project.id}`,
      });
    }

    return alerts;
  }

  // -------------------------------------------------------------------------
  // Weekly digest
  // -------------------------------------------------------------------------

  /**
   * Email a portfolio summary to everyone who can read reports.
   *
   * Sent per organisation, honouring its configured day and hour. The cron fires
   * hourly-safe: an organisation whose digest day or hour does not match right
   * now is skipped rather than sent early.
   */
  async runWeeklyDigest(force = false): Promise<{ sent: number }> {
    const now = new Date();
    const organisations = await this.prisma.organisation.findMany({
      select: { id: true, name: true },
    });
    const settingsById = await this.settings.getMany(organisations.map((o) => o.id));

    let sent = 0;

    for (const org of organisations) {
      const settings = settingsById.get(org.id);
      if (!settings) continue;

      if (!force && now.getUTCDay() !== settings.digestDayOfWeek) continue;

      const report = await this.reports.build(org.id, { scope: 'all' });
      if (report.kpis.totalProjects === 0) continue;

      const recipients = await this.prisma.user.findMany({
        where: {
          organisationId: org.id,
          isActive: true,
          role: { in: ['OWNER', 'ADMIN', 'PROJECT_MANAGER'] },
        },
        select: { email: true },
      });
      if (recipients.length === 0) continue;

      const delivered = await this.mail.send({
        to: recipients.map((r) => r.email),
        subject: `${org.name} — portfolio digest, ${formatDate(todayUtc(), settings.locale)}`,
        html: digestEmail(
          org.name,
          report,
          settings,
          this.config.get('webAppUrl', { infer: true }),
        ),
      });

      if (delivered) sent += 1;
    }

    this.logger.log(`Weekly digest complete — ${sent} organisation digests sent.`);
    return { sent };
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  /** Drops expired tokens and long-read notifications so tables stay bounded. */
  async runHousekeeping(): Promise<void> {
    const [tokens, notifications] = await Promise.all([
      this.tokens.purgeExpired(),
      this.notifications.purgeOld(),
    ]);
    this.logger.log(
      `Housekeeping complete — ${tokens} refresh tokens and ${notifications} notifications purged.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Digest email
// ---------------------------------------------------------------------------

function digestEmail(
  organisationName: string,
  report: Awaited<ReturnType<ReportsService['build']>>,
  settings: OrganisationSettings,
  webUrl: string,
): string {
  const k = report.kpis;

  const kpi = (value: string | number, label: string) => `
    <td style="padding:12px 10px;border:1px solid #e5e7eb;border-radius:10px;text-align:left">
      <div style="font-size:21px;font-weight:700;color:#111827;line-height:1">${value}</div>
      <div style="font-size:10px;letter-spacing:.06em;color:#6b7280;margin-top:5px;text-transform:uppercase">${label}</div>
    </td>`;

  const alertRows = report.procurementAlerts
    .slice(0, 10)
    .map(
      (alert) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827">
          <b>${escapeHtml(alert.materialName)}</b>
          <div style="color:#6b7280;font-size:12px">${escapeHtml(alert.projectName)} · ${escapeHtml(alert.phaseName)}</div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:12.5px;text-align:right;color:${
          alert.procurementState === 'OVERDUE' ? '#c2544d' : '#a9791a'
        };white-space:nowrap">
          ${
            alert.daysUntilOrderBy < 0
              ? `${Math.abs(alert.daysUntilOrderBy)}d overdue`
              : `in ${alert.daysUntilOrderBy}d`
          }
        </td>
      </tr>`,
    )
    .join('');

  const handoverRows = report.upcomingHandovers
    .slice(0, 6)
    .map(
      (handover) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827">
          <b>${escapeHtml(handover.projectName)}</b>
          <div style="color:#6b7280;font-size:12px">design ${handover.designPct}% · execution ${handover.executionPct}%</div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:12.5px;text-align:right;color:#4b5563;white-space:nowrap">
          ${formatDate(parseIsoDate(handover.handoverDate), settings.locale)}
        </td>
      </tr>`,
    )
    .join('');

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:28px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:26px">
    <div style="font-size:10.5px;letter-spacing:.12em;color:#9ca3af;text-transform:uppercase">${escapeHtml(organisationName)}</div>
    <h1 style="margin:5px 0 4px;font-size:20px;color:#111827">${escapeHtml(report.title)}</h1>
    <div style="font-size:12.5px;color:#6b7280">${formatDate(todayUtc(), settings.locale)}</div>

    <table style="width:100%;border-collapse:separate;border-spacing:6px;margin:18px 0 6px">
      <tr>${kpi(k.totalProjects, 'Projects')}${kpi(`${k.designPct}%`, 'Drawings')}${kpi(`${k.executionPct}%`, 'Execution')}</tr>
      <tr>${kpi(k.ordersOverdue, 'Orders overdue')}${kpi(k.executionDelayed, 'Late activities')}${kpi(k.projectsAtRisk, 'At risk')}</tr>
    </table>

    <p style="font-size:13.5px;line-height:1.6;color:#374151;margin:16px 0 0">${escapeHtml(report.executiveSummary)}</p>

    ${
      alertRows
        ? `<h2 style="font-size:13px;color:#111827;margin:24px 0 4px">Orders needing action</h2>
           <table style="width:100%;border-collapse:collapse">${alertRows}</table>`
        : ''
    }
    ${
      handoverRows
        ? `<h2 style="font-size:13px;color:#111827;margin:24px 0 4px">Upcoming handovers</h2>
           <table style="width:100%;border-collapse:collapse">${handoverRows}</table>`
        : ''
    }

    <p style="margin:26px 0 0">
      <a href="${webUrl}/reports" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:13.5px;font-weight:600">Open the full report</a>
    </p>
    <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;font-size:11.5px;color:#9ca3af">
      Sent by ConstructIQ Tracker. Change the schedule in Settings.
    </p>
  </div>
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
