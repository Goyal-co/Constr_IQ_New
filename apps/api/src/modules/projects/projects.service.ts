import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  parseIsoDate,
  suggestOrderByDate,
  type ApplyTemplateDto,
  type CreateProjectDto,
  type OrganisationSettings,
  type Paginated,
  type ProjectDetail,
  type ProjectQueryDto,
  type ProjectSummary,
  type ReorderDto,
  type UpdateProjectDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../organisation/settings.service';
import { TemplatesService } from '../templates/templates.service';
import {
  PROJECT_DETAIL_INCLUDE,
  PROJECT_INCLUDE,
  toProjectDetail,
  toProjectSummary,
  type AttachmentCounts,
  type ProjectWithRelations,
} from './project.mapper';

/**
 * Above this many matching projects, in-memory metric sorting stops being free
 * and the list falls back to database ordering. See `list()`.
 */
const IN_MEMORY_SORT_CEILING = 2000;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly templates: TemplatesService,
  ) {}

  /**
   * Paginated project list.
   *
   * Cheap predicates (search, category, status, phase, handover window) run in
   * Postgres. Risk, drawing progress and execution progress are derived from
   * child rows and today's date, so they are computed in the application and
   * filtered there. For a fit-out portfolio — hundreds of projects, not millions
   * — one indexed query plus an in-memory pass beats maintaining a metrics view,
   * and the ceiling above stops that assumption failing silently as the estate
   * grows.
   */
  async list(organisationId: string, query: ProjectQueryDto): Promise<Paginated<ProjectSummary>> {
    const settings = await this.settings.get(organisationId);
    const where = this.buildWhere(organisationId, query);
    const matching = await this.prisma.project.count({ where });

    const derivedSort =
      query.sort === 'progress' || query.sort === 'execution' || query.sort === 'risk';

    if (matching > IN_MEMORY_SORT_CEILING && !query.atRisk && !derivedSort) {
      const rows = await this.prisma.project.findMany({
        where,
        include: PROJECT_INCLUDE,
        orderBy: this.databaseOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return this.paginate(
        rows.map((r) => toProjectSummary(r as ProjectWithRelations, settings)),
        matching,
        query,
      );
    }

    const rows = await this.prisma.project.findMany({ where, include: PROJECT_INCLUDE });
    let items = rows.map((r) => toProjectSummary(r as ProjectWithRelations, settings));

    if (query.atRisk) items = items.filter((p) => p.metrics.atRisk);

    items.sort(this.comparator(query));

    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return this.paginate(items.slice(start, start + query.pageSize), total, query);
  }

  private buildWhere(organisationId: string, query: ProjectQueryDto): Prisma.ProjectWhereInput {
    return {
      organisationId,
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.managerId ? { managerId: query.managerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.scope === 'active' ? { status: { not: 'COMPLETED' as const } } : {}),
      ...(query.scope === 'completed' ? { status: 'COMPLETED' as const } : {}),
      ...(query.phaseId
        ? {
            OR: [
              { workItems: { some: { phaseId: query.phaseId } } },
              { materials: { some: { phaseId: query.phaseId } } },
            ],
          }
        : {}),
      ...(query.handoverBefore || query.handoverAfter
        ? {
            handoverDate: {
              ...(query.handoverAfter ? { gte: parseIsoDate(query.handoverAfter)! } : {}),
              ...(query.handoverBefore ? { lte: parseIsoDate(query.handoverBefore)! } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { consultant: { contains: query.search, mode: 'insensitive' as const } },
              { vendor: { contains: query.search, mode: 'insensitive' as const } },
              { siteAddress: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  private paginate<T>(items: T[], total: number, query: ProjectQueryDto): Paginated<T> {
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  private databaseOrderBy(query: ProjectQueryDto): Prisma.ProjectOrderByWithRelationInput[] {
    const dir = query.order;
    switch (query.sort) {
      case 'name':
        return [{ name: dir }];
      case 'handover':
        // Undated projects belong at the end regardless of direction.
        return [{ handoverDate: { sort: dir, nulls: 'last' } }, { name: 'asc' }];
      case 'updated':
        return [{ updatedAt: dir }];
      default:
        return [{ position: dir }, { name: 'asc' }];
    }
  }

  private comparator(query: ProjectQueryDto): (a: ProjectSummary, b: ProjectSummary) => number {
    const sign = query.order === 'desc' ? -1 : 1;
    return (a, b) => {
      switch (query.sort) {
        case 'name':
          return sign * a.name.localeCompare(b.name);
        case 'handover': {
          if (!a.handoverDate && !b.handoverDate) return a.name.localeCompare(b.name);
          if (!a.handoverDate) return 1;
          if (!b.handoverDate) return -1;
          return sign * a.handoverDate.localeCompare(b.handoverDate);
        }
        case 'progress':
          return sign * (a.metrics.designPct - b.metrics.designPct) || a.name.localeCompare(b.name);
        case 'execution':
          return (
            sign * (a.metrics.executionPct - b.metrics.executionPct) || a.name.localeCompare(b.name)
          );
        case 'risk': {
          // Most reasons first — a project failing three rules outranks one.
          const delta = a.metrics.riskReasons.length - b.metrics.riskReasons.length;
          return sign * -delta || a.name.localeCompare(b.name);
        }
        case 'updated':
          return sign * a.updatedAt.localeCompare(b.updatedAt);
        default:
          return (
            sign * (a.position - b.position) ||
            a.category.position - b.category.position ||
            a.name.localeCompare(b.name)
          );
      }
    };
  }

  async findOne(organisationId: string, id: string): Promise<ProjectDetail> {
    const settings = await this.settings.get(organisationId);
    const project = await this.prisma.project.findFirst({
      where: { id, organisationId, deletedAt: null },
      include: PROJECT_DETAIL_INCLUDE,
    });
    if (!project) throw new NotFoundException('That project does not exist, or you cannot see it.');

    const counts = await this.attachmentCounts(organisationId, project as ProjectWithRelations);
    return toProjectDetail(project as ProjectWithRelations, settings, counts);
  }

  /**
   * One grouped query for attachment counts across every child of the project,
   * instead of an N+1 count per drawing, material and activity.
   */
  private async attachmentCounts(
    organisationId: string,
    project: ProjectWithRelations,
  ): Promise<AttachmentCounts> {
    const ids = [
      project.id,
      ...project.designFiles.map((f) => f.id),
      ...project.workItems.map((w) => w.id),
      ...project.materials.map((m) => m.id),
    ];
    const grouped = await this.prisma.attachment.groupBy({
      by: ['entityId'],
      where: { organisationId, entityId: { in: ids } },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.entityId, g._count._all]));
  }

  /**
   * Create a project, optionally seeded from one of the organisation's templates.
   *
   * The template is applied inside the same transaction as the project row: a
   * project that exists with half its checklist is worse than one that failed to
   * be created at all.
   */
  async create(
    actor: AuthenticatedUser,
    dto: CreateProjectDto,
    client?: ClientMeta,
  ): Promise<ProjectDetail> {
    const settings = await this.settings.get(actor.organisationId);

    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, organisationId: actor.organisationId },
    });
    if (!category) throw new BadRequestException('That category does not exist.');

    if (dto.managerId) await this.assertMember(actor.organisationId, dto.managerId);

    const handoverDate = parseIsoDate(dto.handoverDate ?? null);

    // Omitting templateId falls back to the organisation's default playbook, if
    // one is marked. Passing null explicitly creates an empty project.
    const templateId =
      dto.templateId === null
        ? null
        : (dto.templateId ?? (await this.templates.defaultTemplateId(actor.organisationId)));

    const seedRows = templateId
      ? await this.buildTemplateRows(actor.organisationId, templateId, handoverDate, settings)
      : null;

    const last = await this.prisma.project.findFirst({
      where: { organisationId: actor.organisationId, categoryId: dto.categoryId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          organisationId: actor.organisationId,
          categoryId: dto.categoryId,
          name: dto.name,
          code: dto.code ?? null,
          consultant: dto.consultant ?? null,
          vendor: dto.vendor ?? null,
          status: dto.status,
          handoverDate,
          description: dto.description ?? null,
          siteAddress: dto.siteAddress ?? null,
          budgetAmount: dto.budgetAmount ?? null,
          currency: dto.currency ?? settings.defaultCurrency,
          managerId: dto.managerId ?? null,
          position: (last?.position ?? -1) + 1,
        },
      });

      if (seedRows) await this.insertTemplateRows(tx, project.id, seedRows);

      // The manager is always a member; otherwise they cannot be notified about
      // the project they own.
      if (dto.managerId) {
        await tx.projectMember.create({
          data: { projectId: project.id, userId: dto.managerId, projectRole: 'Project Manager' },
        });
      }

      return project;
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'project.created',
      entityType: 'Project',
      entityId: created.id,
      entityLabel: created.name,
      after: {
        name: created.name,
        status: created.status,
        categoryId: created.categoryId,
        handoverDate: created.handoverDate,
        consultant: created.consultant,
        vendor: created.vendor,
        templateId,
        seededItems: seedRows
          ? seedRows.designFiles.length + seedRows.workItems.length + seedRows.materials.length
          : 0,
      },
      client,
    });

    if (dto.managerId && dto.managerId !== actor.id) {
      await this.notifications.push({
        organisationId: actor.organisationId,
        userId: dto.managerId,
        kind: 'PROJECT_ASSIGNED',
        title: `You now manage ${created.name}`,
        body: `${actor.name} assigned you as project manager.`,
        projectId: created.id,
      });
    }

    return this.findOne(actor.organisationId, created.id);
  }

  /**
   * Apply a template to a project that already exists, appending to its lists.
   *
   * Existing rows are left alone — this adds a phase's worth of scope to a live
   * project rather than resetting it.
   */
  async applyTemplate(
    actor: AuthenticatedUser,
    projectId: string,
    dto: ApplyTemplateDto,
    client?: ClientMeta,
  ): Promise<ProjectDetail> {
    const settings = await this.settings.get(actor.organisationId);
    const project = await this.assertProject(actor.organisationId, projectId);

    const rows = await this.buildTemplateRows(
      actor.organisationId,
      dto.templateId,
      dto.seedPlannedDates ? project.handoverDate : null,
      settings,
    );

    await this.prisma.$transaction(async (tx) => {
      await this.insertTemplateRows(tx, projectId, rows, true);
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'project.template_applied',
      entityType: 'Project',
      entityId: projectId,
      entityLabel: project.name,
      after: {
        templateId: dto.templateId,
        designFilesAdded: rows.designFiles.length,
        workItemsAdded: rows.workItems.length,
        materialsAdded: rows.materials.length,
      },
      client,
    });

    return this.findOne(actor.organisationId, projectId);
  }

  /**
   * Turn template items into insertable rows for the three sections.
   *
   * Work-item offsets are days relative to handover — negative means before — so
   * a template describes a shape ("start six weeks out, finish two weeks out")
   * rather than fixed dates. With no handover date, items are created undated and
   * simply stay off the programme chart until somebody schedules them.
   *
   * Material lead times are used the same way, to suggest an order-by date. The
   * date is what gets stored; the lead time is kept only so it can be recalculated
   * if the handover moves.
   */
  private async buildTemplateRows(
    organisationId: string,
    templateId: string,
    handoverDate: Date | null,
    settings: OrganisationSettings,
  ) {
    const items = await this.templates.itemsFor(organisationId, templateId);

    const designFiles: { name: string; position: number }[] = [];
    const workItems: {
      phaseId: string;
      name: string;
      position: number;
      plannedStart: Date | null;
      plannedEnd: Date | null;
    }[] = [];
    const materials: {
      phaseId: string;
      name: string;
      position: number;
      leadTimeWeeks: number | null;
      orderByDate: Date | null;
    }[] = [];

    for (const item of items) {
      switch (item.kind) {
        case 'DESIGN_FILE':
          designFiles.push({ name: item.name, position: designFiles.length });
          break;

        case 'WORK_ITEM':
          // A work item must have a phase — it is the thing that puts it under
          // Design -> {phase} and Execution -> {phase}. Skip malformed rows
          // rather than failing the whole project creation.
          if (!item.phaseId) break;
          workItems.push({
            phaseId: item.phaseId,
            name: item.name,
            position: workItems.length,
            plannedStart:
              handoverDate && item.offsetStartDays != null
                ? addDays(handoverDate, item.offsetStartDays)
                : null,
            plannedEnd:
              handoverDate && item.offsetEndDays != null
                ? addDays(handoverDate, item.offsetEndDays)
                : null,
          });
          break;

        case 'MATERIAL': {
          if (!item.phaseId) break;
          const leadTimeWeeks = item.leadTimeWeeks ?? settings.defaultLeadTimeWeeks;
          materials.push({
            phaseId: item.phaseId,
            name: item.name,
            position: materials.length,
            leadTimeWeeks,
            orderByDate: suggestOrderByDate(handoverDate, leadTimeWeeks),
          });
          break;
        }
      }
    }

    return { designFiles, workItems, materials };
  }

  private async insertTemplateRows(
    tx: Prisma.TransactionClient,
    projectId: string,
    rows: Awaited<ReturnType<ProjectsService['buildTemplateRows']>>,
    append = false,
  ): Promise<void> {
    // When appending to a live project, continue numbering after what is there.
    const offsets = append
      ? {
          designFiles: await tx.designFile.count({ where: { projectId } }),
          workItems: await tx.workItem.count({ where: { projectId } }),
          materials: await tx.material.count({ where: { projectId } }),
        }
      : { designFiles: 0, workItems: 0, materials: 0 };

    if (rows.designFiles.length > 0) {
      await tx.designFile.createMany({
        data: rows.designFiles.map((f) => ({
          projectId,
          name: f.name,
          position: f.position + offsets.designFiles,
        })),
      });
    }
    if (rows.workItems.length > 0) {
      await tx.workItem.createMany({
        data: rows.workItems.map((w) => ({
          projectId,
          phaseId: w.phaseId,
          name: w.name,
          position: w.position + offsets.workItems,
          plannedStart: w.plannedStart,
          plannedEnd: w.plannedEnd,
        })),
      });
    }
    if (rows.materials.length > 0) {
      await tx.material.createMany({
        data: rows.materials.map((m) => ({
          projectId,
          phaseId: m.phaseId,
          name: m.name,
          position: m.position + offsets.materials,
          leadTimeWeeks: m.leadTimeWeeks,
          orderByDate: m.orderByDate,
        })),
      });
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProjectDto,
    client?: ClientMeta,
  ): Promise<ProjectDetail> {
    const existing = await this.prisma.project.findFirst({
      where: { id, organisationId: actor.organisationId, deletedAt: null },
    });
    if (!existing)
      throw new NotFoundException('That project does not exist, or you cannot see it.');

    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, organisationId: actor.organisationId },
      });
      if (!category) throw new BadRequestException('That category does not exist.');
    }
    if (dto.managerId) await this.assertMember(actor.organisationId, dto.managerId);

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.consultant !== undefined) data.consultant = dto.consultant;
    if (dto.vendor !== undefined) data.vendor = dto.vendor;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.siteAddress !== undefined) data.siteAddress = dto.siteAddress;
    if (dto.budgetAmount !== undefined) data.budgetAmount = dto.budgetAmount;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.handoverDate !== undefined) data.handoverDate = parseIsoDate(dto.handoverDate);
    if (dto.categoryId !== undefined) data.category = { connect: { id: dto.categoryId } };
    if (dto.managerId !== undefined) {
      data.manager = dto.managerId ? { connect: { id: dto.managerId } } : { disconnect: true };
    }

    const updated = await this.prisma.project.update({ where: { id }, data });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action:
        dto.status && dto.status !== existing.status ? 'project.status_changed' : 'project.updated',
      entityType: 'Project',
      entityId: id,
      entityLabel: updated.name,
      before: snapshot(existing),
      after: snapshot(updated),
      client,
    });

    if (dto.managerId && dto.managerId !== existing.managerId && dto.managerId !== actor.id) {
      await this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: id, userId: dto.managerId } },
        create: { projectId: id, userId: dto.managerId, projectRole: 'Project Manager' },
        update: {},
      });
      await this.notifications.push({
        organisationId: actor.organisationId,
        userId: dto.managerId,
        kind: 'PROJECT_ASSIGNED',
        title: `You now manage ${updated.name}`,
        body: `${actor.name} assigned you as project manager.`,
        projectId: id,
      });
    }

    return this.findOne(actor.organisationId, id);
  }

  /**
   * Soft delete.
   *
   * The row stays so the audit trail keeps pointing at something real and a
   * mistaken deletion is recoverable. Children are untouched; the project is
   * simply excluded from every query by `deletedAt: null`.
   */
  async remove(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.project.findFirst({
      where: { id, organisationId: actor.organisationId, deletedAt: null },
    });
    if (!existing)
      throw new NotFoundException('That project does not exist, or you cannot see it.');

    await this.prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'project.deleted',
      entityType: 'Project',
      entityId: id,
      entityLabel: existing.name,
      before: snapshot(existing),
      client,
    });

    return { success: true };
  }

  async restore(actor: AuthenticatedUser, id: string, client?: ClientMeta): Promise<ProjectDetail> {
    const existing = await this.prisma.project.findFirst({
      where: { id, organisationId: actor.organisationId, deletedAt: { not: null } },
    });
    if (!existing) throw new NotFoundException('No deleted project with that id.');

    await this.prisma.project.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'project.restored',
      entityType: 'Project',
      entityId: id,
      entityLabel: existing.name,
      client,
    });
    return this.findOne(actor.organisationId, id);
  }

  /**
   * Rewrite manual ordering from a client-supplied id sequence.
   *
   * Positions are reassigned from the array index rather than swapped pairwise,
   * so a reorder is idempotent and cannot leave two projects sharing a position.
   */
  async reorder(actor: AuthenticatedUser, dto: ReorderDto): Promise<{ success: true }> {
    const owned = await this.prisma.project.count({
      where: { id: { in: dto.ids }, organisationId: actor.organisationId, deletedAt: null },
    });
    if (owned !== dto.ids.length) {
      throw new BadRequestException('That list includes a project you cannot reorder.');
    }

    await this.prisma.$transaction(
      dto.ids.map((id, position) =>
        this.prisma.project.update({ where: { id }, data: { position } }),
      ),
    );
    return { success: true };
  }

  /** Guards against assigning a project to a user from another tenant. */
  private async assertMember(organisationId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organisationId, isActive: true },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('That user is not an active member of this organisation.');
    }
  }

  /** Loads a project for a child service, enforcing tenancy in one place. */
  async assertProject(organisationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organisationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        handoverDate: true,
        organisationId: true,
        managerId: true,
        status: true,
      },
    });
    if (!project) throw new NotFoundException('That project does not exist, or you cannot see it.');
    return project;
  }
}

/** The subset of project fields worth recording in the audit trail. */
function snapshot(project: {
  name: string;
  status: string;
  categoryId: string;
  handoverDate: Date | null;
  consultant: string | null;
  vendor: string | null;
  managerId: string | null;
  budgetAmount: unknown;
}) {
  return {
    name: project.name,
    status: project.status,
    categoryId: project.categoryId,
    handoverDate: project.handoverDate,
    consultant: project.consultant,
    vendor: project.vendor,
    managerId: project.managerId,
    budgetAmount: project.budgetAmount,
  };
}
