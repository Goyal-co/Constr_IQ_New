import { Injectable } from '@nestjs/common';
import {
  buildExecutiveSummary,
  computeMaterialSchedule,
  PROJECT_STATUSES,
  todayUtc,
  type ActivityStatus,
  type CategoryBreakdown,
  type MaterialStatus,
  type OrganisationSettings,
  type PhaseBreakdown,
  type PortfolioKpis,
  type PortfolioReport,
  type ProcurementAlert,
  type ProjectStatus,
  type ProjectSummary,
  type ReportDto,
  type ReportQueryDto,
  type UpcomingHandover,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../organisation/settings.service';
import { toPhase } from '../phases/phases.service';
import {
  PROJECT_INCLUDE,
  toProjectSummary,
  type ProjectWithRelations,
} from '../projects/project.mapper';

/** How many rows the two "nearest first" panels show. */
const UPCOMING_LIMIT = 8;
const PROCUREMENT_ALERT_LIMIT = 25;

/**
 * Portfolio reporting.
 *
 * Every number here is a count or an average over rows that exist, computed with
 * the organisation's own thresholds. Nothing is estimated, extrapolated or
 * carried over from a previous period — if the report says four orders are
 * overdue, four rows satisfy the overdue predicate right now.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async build(organisationId: string, query: ReportQueryDto): Promise<PortfolioReport> {
    const now = todayUtc();
    const settings = await this.settings.get(organisationId);

    const [rows, reportSetting, phases] = await Promise.all([
      this.prisma.project.findMany({
        where: {
          organisationId,
          deletedAt: null,
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.managerId ? { managerId: query.managerId } : {}),
          // Scoping to one project makes every figure below describe that
          // project alone, which is the point of the filter.
          ...(query.projectId ? { id: query.projectId } : {}),
          ...(query.scope === 'active' ? { status: { not: 'COMPLETED' as const } } : {}),
          ...(query.scope === 'completed' ? { status: 'COMPLETED' as const } : {}),
        },
        include: PROJECT_INCLUDE,
      }),
      this.prisma.reportSetting.findUnique({ where: { organisationId } }),
      this.prisma.phase.findMany({
        where: { organisationId },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const projects = rows as ProjectWithRelations[];
    const summaries = projects.map((row) => toProjectSummary(row, settings, now));

    const kpis = this.buildKpis(projects, summaries, settings);
    const byCategory = this.buildCategoryBreakdown(summaries);
    const byPhase = this.buildPhaseBreakdown(projects, phases, settings, now);
    const upcomingHandovers = this.buildUpcomingHandovers(summaries);
    const procurementAlerts = this.buildProcurementAlerts(projects, settings, now);

    return {
      generatedAt: new Date().toISOString(),
      title: reportSetting?.title ?? 'Portfolio Status Report',
      commentary: reportSetting?.commentary ?? '',
      executiveSummary: buildExecutiveSummary(kpis, upcomingHandovers, now, settings.locale),
      kpis,
      byCategory,
      byPhase,
      upcomingHandovers,
      procurementAlerts,
      atRisk: summaries
        .filter((p) => p.metrics.atRisk)
        .sort((a, b) => b.metrics.riskReasons.length - a.metrics.riskReasons.length),
      statusSheet: this.sortStatusSheet(summaries),
    };
  }

  /**
   * Portfolio totals.
   *
   * Percentages are weighted by item count rather than averaged across projects:
   * a project with two drawings should not sway the portfolio figure as much as
   * one with sixty. Averaging the percentages would let it.
   */
  /**
   * Portfolio totals.
   *
   * Percentages are weighted by item count rather than averaged across projects:
   * a project with two work items should not sway the portfolio figure as much
   * as one with sixty. Averaging the percentages would let it.
   */
  private buildKpis(
    projects: ProjectWithRelations[],
    summaries: ProjectSummary[],
    settings: OrganisationSettings,
  ): PortfolioKpis {
    const byStatus = Object.fromEntries(
      PROJECT_STATUSES.map((status) => [
        status,
        summaries.filter((p) => p.status === status).length,
      ]),
    ) as Record<ProjectStatus, number>;

    const designTotal = summaries.reduce((sum, p) => sum + p.metrics.designTotal, 0);
    const designComplete = summaries.reduce((sum, p) => sum + p.metrics.designComplete, 0);

    const workItemsTotal = summaries.reduce((sum, p) => sum + p.metrics.workItemsTotal, 0);
    const weightedExecutionScore = projects.reduce(
      (sum, project) =>
        sum +
        project.workItems.reduce(
          (inner, item) =>
            inner + (settings.activityStatusWeights[item.executionStatus as ActivityStatus] ?? 0),
          0,
        ),
      0,
    );

    return {
      totalProjects: summaries.length,
      activeProjects: summaries.filter((p) => p.status !== 'COMPLETED').length,
      completedProjects: byStatus.COMPLETED,
      byStatus,
      designTotal,
      designComplete,
      designPct: designTotal > 0 ? Math.round((designComplete / designTotal) * 100) : 0,
      workItemsTotal,
      executionDelayed: summaries.reduce((sum, p) => sum + p.metrics.executionDelayed, 0),
      executionBlocked: summaries.reduce((sum, p) => sum + p.metrics.executionBlocked, 0),
      executionPct: workItemsTotal > 0 ? Math.round(weightedExecutionScore / workItemsTotal) : 0,
      materialsTotal: summaries.reduce((sum, p) => sum + p.metrics.materialsTotal, 0),
      ordersOverdue: summaries.reduce((sum, p) => sum + p.metrics.materialsOverdue, 0),
      ordersDueSoon: summaries.reduce((sum, p) => sum + p.metrics.materialsDueSoon, 0),
      projectsAtRisk: summaries.filter((p) => p.metrics.atRisk).length,
    };
  }

  /** Status distribution per category, driven by the categories in use. */
  private buildCategoryBreakdown(summaries: ProjectSummary[]): CategoryBreakdown[] {
    const groups = new Map<string, { name: string; position: number; items: ProjectSummary[] }>();

    for (const project of summaries) {
      const existing = groups.get(project.category.id);
      if (existing) existing.items.push(project);
      else {
        groups.set(project.category.id, {
          name: project.category.name,
          position: project.category.position,
          items: [project],
        });
      }
    }

    return [...groups.entries()]
      .sort((a, b) => a[1].position - b[1].position || a[1].name.localeCompare(b[1].name))
      .map(([categoryId, group]) => ({
        categoryId,
        categoryName: group.name,
        total: group.items.length,
        counts: Object.fromEntries(
          PROJECT_STATUSES.map((status) => [
            status,
            group.items.filter((p) => p.status === status).length,
          ]),
        ) as Record<ProjectStatus, number>,
      }));
  }

  /** Design and execution progress per phase, for the phases actually in use. */
  private buildPhaseBreakdown(
    projects: ProjectWithRelations[],
    phases: { id: string; name: string; colour: string; position: number; isArchived: boolean }[],
    settings: OrganisationSettings,
    now: Date,
  ): PhaseBreakdown[] {
    return (
      phases
        .map((phase) => {
          const workItems = projects.flatMap((p) =>
            p.workItems.filter((w) => w.phaseId === phase.id),
          );

          let materialsOutstanding = 0;
          let projectCount = 0;
          for (const project of projects) {
            const materials = project.materials.filter((m) => m.phaseId === phase.id);
            const touches =
              materials.length > 0 || project.workItems.some((w) => w.phaseId === phase.id);
            if (touches) projectCount += 1;

            for (const material of materials) {
              const { procurementState } = computeMaterialSchedule(
                { status: material.status as MaterialStatus, orderByDate: material.orderByDate },
                settings,
                now,
              );
              if (
                procurementState === 'OVERDUE' ||
                procurementState === 'DUE_SOON' ||
                procurementState === 'SCHEDULED'
              ) {
                materialsOutstanding += 1;
              }
            }
          }

          const designComplete = workItems.filter((w) => w.designComplete).length;
          const executionScore = workItems.reduce(
            (sum, w) =>
              sum + (settings.activityStatusWeights[w.executionStatus as ActivityStatus] ?? 0),
            0,
          );

          return {
            phase: toPhase(phase as never),
            projectCount,
            designPct:
              workItems.length > 0 ? Math.round((designComplete / workItems.length) * 100) : 0,
            executionPct: workItems.length > 0 ? Math.round(executionScore / workItems.length) : 0,
            materialsOutstanding,
          };
        })
        // A phase nothing references adds a blank row to every report.
        .filter((row) => row.projectCount > 0)
    );
  }

  private buildUpcomingHandovers(summaries: ProjectSummary[]): UpcomingHandover[] {
    return summaries
      .filter((p) => p.status !== 'COMPLETED' && p.handoverDate)
      .sort((a, b) => a.handoverDate!.localeCompare(b.handoverDate!))
      .slice(0, UPCOMING_LIMIT)
      .map((p) => ({
        projectId: p.id,
        projectName: p.name,
        handoverDate: p.handoverDate!,
        daysRemaining: p.metrics.daysToHandover ?? 0,
        designPct: p.metrics.designPct,
        executionPct: p.metrics.executionPct,
        atRisk: p.metrics.atRisk,
      }));
  }

  /**
   * The cross-project buying list.
   *
   * Only items still needing action appear, ordered by how soon they must be
   * raised. Each carries the work item it gates, because "order these" is far
   * more persuasive when it says what stops if you do not.
   */
  private buildProcurementAlerts(
    projects: ProjectWithRelations[],
    settings: OrganisationSettings,
    now: Date,
  ): ProcurementAlert[] {
    const alerts: ProcurementAlert[] = [];

    for (const project of projects) {
      if (project.status === 'COMPLETED') continue;

      for (const material of project.materials) {
        const schedule = computeMaterialSchedule(
          { status: material.status as MaterialStatus, orderByDate: material.orderByDate },
          settings,
          now,
        );
        if (schedule.procurementState !== 'OVERDUE' && schedule.procurementState !== 'DUE_SOON') {
          continue;
        }
        if (!schedule.orderByDate) continue;

        alerts.push({
          materialId: material.id,
          materialName: material.name,
          projectId: project.id,
          projectName: project.name,
          phaseName: material.phase.name,
          leadTimeWeeks: material.leadTimeWeeks,
          orderByDate: schedule.orderByDate,
          daysUntilOrderBy: schedule.daysUntilOrderBy ?? 0,
          procurementState: schedule.procurementState,
          supplier: material.supplier,
          blocksWorkItemName: material.workItem?.name ?? null,
        });
      }
    }

    return alerts
      .sort((a, b) => a.daysUntilOrderBy - b.daysUntilOrderBy)
      .slice(0, PROCUREMENT_ALERT_LIMIT);
  }

  /** Live work first, then by handover date — how management reads the sheet. */
  private sortStatusSheet(summaries: ProjectSummary[]): ProjectSummary[] {
    return [...summaries].sort((a, b) => {
      const aDone = a.status === 'COMPLETED' ? 1 : 0;
      const bDone = b.status === 'COMPLETED' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      if (a.handoverDate && b.handoverDate) return a.handoverDate.localeCompare(b.handoverDate);
      if (a.handoverDate) return -1;
      if (b.handoverDate) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Title and management commentary — the only hand-written part of the report. */
  async saveMeta(
    actor: AuthenticatedUser,
    dto: ReportDto,
    client?: ClientMeta,
  ): Promise<{ title: string; commentary: string }> {
    const existing = await this.prisma.reportSetting.findUnique({
      where: { organisationId: actor.organisationId },
    });

    const saved = await this.prisma.reportSetting.upsert({
      where: { organisationId: actor.organisationId },
      create: {
        organisationId: actor.organisationId,
        title: dto.title ?? 'Portfolio Status Report',
        commentary: dto.commentary ?? '',
        updatedById: actor.id,
      },
      update: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.commentary !== undefined ? { commentary: dto.commentary } : {}),
        updatedById: actor.id,
      },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'report.updated',
      entityType: 'Report',
      entityId: actor.organisationId,
      entityLabel: saved.title,
      before: existing ? { title: existing.title, commentary: existing.commentary } : null,
      after: { title: saved.title, commentary: saved.commentary },
      client,
    });

    return { title: saved.title, commentary: saved.commentary };
  }
}
