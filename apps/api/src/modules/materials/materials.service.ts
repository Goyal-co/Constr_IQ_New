import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isMaterialBlocking,
  parseIsoDate,
  suggestOrderByDate,
  todayUtc,
  toIsoDate,
  type CreateMaterialDto,
  type Material,
  type MaterialStatus,
  type UpdateMaterialDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../organisation/settings.service';
import { PhasesService } from '../phases/phases.service';
import { ProjectsService } from '../projects/projects.service';
import { toMaterial, type MaterialWithRelations } from '../projects/project.mapper';

const MATERIAL_INCLUDE = {
  phase: true,
  workItem: { include: { phase: true } },
} as const;

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly phases: PhasesService,
    private readonly projects: ProjectsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * A material may only gate a work item in its own phase.
   *
   * This is what makes the tag meaningful: choosing "Civil" narrows the link
   * dropdown to Civil work items, and the server enforces the same narrowing so a
   * crafted request cannot attach floor tiles to a design review.
   */
  private async assertLinkable(
    projectId: string,
    phaseId: string,
    workItemId: string,
  ): Promise<void> {
    const item = await this.prisma.workItem.findFirst({
      where: { id: workItemId, projectId },
      select: { id: true, phaseId: true, phase: { select: { name: true } } },
    });
    if (!item) throw new BadRequestException('That work item does not exist on this project.');

    if (item.phaseId !== phaseId) {
      throw new BadRequestException(
        `That work item is in ${item.phase.name}. A material can only be linked to a work item ` +
          'with the same tag — change the tag first, or pick a different item.',
      );
    }
  }

  async create(
    actor: AuthenticatedUser,
    projectId: string,
    dto: CreateMaterialDto,
    client?: ClientMeta,
  ): Promise<Material> {
    const settings = await this.settings.get(actor.organisationId);
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const phase = await this.phases.assertPhase(actor.organisationId, dto.phaseId);

    if (dto.workItemId) await this.assertLinkable(projectId, dto.phaseId, dto.workItemId);

    // The date is entered directly. Lead time is only a fallback so an item
    // raised with "12 weeks" and no date still lands somewhere sensible.
    const orderByDate =
      parseIsoDate(dto.orderByDate ?? null) ??
      suggestOrderByDate(project.handoverDate, dto.leadTimeWeeks ?? null);

    const last = await this.prisma.material.findFirst({
      where: { projectId, phaseId: dto.phaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const material = await this.prisma.material.create({
      data: {
        projectId,
        phaseId: dto.phaseId,
        name: dto.name,
        orderByDate,
        leadTimeWeeks: dto.leadTimeWeeks ?? null,
        workItemId: dto.workItemId ?? null,
        supplier: dto.supplier ?? null,
        notes: dto.notes ?? null,
        position: (last?.position ?? -1) + 1,
      },
      include: MATERIAL_INCLUDE,
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'material.created',
      entityType: 'Material',
      entityId: material.id,
      entityLabel: `${project.name} · ${material.name}`,
      after: {
        name: material.name,
        phase: phase.name,
        orderByDate: material.orderByDate,
        linkedTo: material.workItem?.name ?? null,
      },
      client,
    });

    return toMaterial(material as MaterialWithRelations, settings);
  }

  /**
   * Update a material, keeping status and the date fields consistent.
   *
   * Marking something Ordered without an order date, or Delivered without a
   * delivery date, leaves procurement unable to answer "when?" a month later — so
   * dates are stamped automatically when the caller omits them, and the status is
   * advanced when a date arrives on its own.
   */
  async update(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: UpdateMaterialDto,
    client?: ClientMeta,
  ): Promise<Material> {
    const settings = await this.settings.get(actor.organisationId);
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.prisma.material.findFirst({
      where: { id, projectId },
      include: MATERIAL_INCLUDE,
    });
    if (!existing) throw new NotFoundException('That material does not exist on this project.');

    const nextPhaseId = dto.phaseId ?? existing.phaseId;
    if (dto.phaseId) await this.phases.assertPhase(actor.organisationId, dto.phaseId);

    // Re-tagging can orphan an existing link: a Civil material moved to Finishing
    // can no longer gate a Civil activity. Drop the link rather than leave an
    // invalid one in place.
    let nextWorkItemId = dto.workItemId !== undefined ? dto.workItemId : existing.workItemId;
    if (nextWorkItemId) {
      if (dto.phaseId && dto.workItemId === undefined && existing.workItem) {
        if (existing.workItem.phaseId !== nextPhaseId) nextWorkItemId = null;
      }
      if (nextWorkItemId) await this.assertLinkable(projectId, nextPhaseId, nextWorkItemId);
    }

    const today = todayUtc();
    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phaseId !== undefined) data.phaseId = dto.phaseId;
    if (dto.supplier !== undefined) data.supplier = dto.supplier;
    if (dto.poNumber !== undefined) data.poNumber = dto.poNumber;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.leadTimeWeeks !== undefined) data.leadTimeWeeks = dto.leadTimeWeeks;
    if (dto.orderByDate !== undefined) data.orderByDate = parseIsoDate(dto.orderByDate);
    if (dto.orderedAt !== undefined) data.orderedAt = parseIsoDate(dto.orderedAt);
    if (dto.deliveredAt !== undefined) data.deliveredAt = parseIsoDate(dto.deliveredAt);
    if (nextWorkItemId !== existing.workItemId) data.workItemId = nextWorkItemId;

    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'ORDERED' && !existing.orderedAt && dto.orderedAt === undefined) {
        data.orderedAt = today;
      }
      if (dto.status === 'DELIVERED') {
        if (!existing.deliveredAt && dto.deliveredAt === undefined) data.deliveredAt = today;
        // Something cannot arrive without having been ordered.
        if (!existing.orderedAt && dto.orderedAt === undefined) data.orderedAt = today;
      }
      if (dto.status === 'PENDING') {
        data.orderedAt = null;
        data.deliveredAt = null;
      }
    } else if (dto.deliveredAt && existing.status !== 'DELIVERED') {
      data.status = 'DELIVERED';
    } else if (dto.orderedAt && existing.status === 'PENDING') {
      data.status = 'ORDERED';
    }

    const material = await this.prisma.material.update({
      where: { id },
      data,
      include: MATERIAL_INCLUDE,
    });

    const wasBlocking = isMaterialBlocking({
      status: existing.status as MaterialStatus,
      orderByDate: existing.orderByDate,
      workItemId: existing.workItemId,
    });
    const nowBlocking = isMaterialBlocking({
      status: material.status as MaterialStatus,
      orderByDate: material.orderByDate,
      workItemId: material.workItemId,
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action:
        dto.status === 'ORDERED' && existing.status !== 'ORDERED'
          ? 'material.ordered'
          : dto.status === 'DELIVERED' && existing.status !== 'DELIVERED'
            ? 'material.delivered'
            : nextWorkItemId !== existing.workItemId
              ? 'material.link_changed'
              : 'material.updated',
      entityType: 'Material',
      entityId: id,
      entityLabel: `${project.name} · ${material.name}`,
      before: {
        name: existing.name,
        phase: existing.phase.name,
        orderByDate: existing.orderByDate,
        leadTimeWeeks: existing.leadTimeWeeks,
        status: existing.status,
        supplier: existing.supplier,
        poNumber: existing.poNumber,
        orderedAt: existing.orderedAt,
        deliveredAt: existing.deliveredAt,
        linkedTo: existing.workItem?.name ?? null,
      },
      after: {
        name: material.name,
        phase: material.phase.name,
        orderByDate: material.orderByDate,
        leadTimeWeeks: material.leadTimeWeeks,
        status: material.status,
        supplier: material.supplier,
        poNumber: material.poNumber,
        orderedAt: material.orderedAt,
        deliveredAt: material.deliveredAt,
        linkedTo: material.workItem?.name ?? null,
      },
      client,
    });

    // Delivery unblocks work. Telling the assignee is the whole point of the
    // link — otherwise they discover it by trying and failing.
    if (wasBlocking && !nowBlocking && material.workItem) {
      const assigneeId =
        (
          await this.prisma.workItem.findUnique({
            where: { id: material.workItem.id },
            select: { assigneeId: true },
          })
        )?.assigneeId ?? project.managerId;

      if (assigneeId && assigneeId !== actor.id) {
        await this.notifications.push({
          organisationId: actor.organisationId,
          userId: assigneeId,
          kind: 'MATERIAL_DUE_SOON',
          title: `${material.name} has arrived`,
          body: `${material.workItem.name} on ${project.name} is no longer waiting on materials.`,
          projectId,
          dedupeKey: `material-unblocked:${material.id}`,
        });
      }
    }

    return toMaterial(material as MaterialWithRelations, settings);
  }

  async remove(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.prisma.material.findFirst({
      where: { id, projectId },
      include: MATERIAL_INCLUDE,
    });
    if (!existing) throw new NotFoundException('That material does not exist on this project.');

    await this.prisma.material.delete({ where: { id } });
    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'material.deleted',
      entityType: 'Material',
      entityId: id,
      entityLabel: `${project.name} · ${existing.name}`,
      before: {
        name: existing.name,
        phase: existing.phase.name,
        status: existing.status,
        linkedTo: existing.workItem?.name ?? null,
      },
      client,
    });
    return { success: true };
  }

  /**
   * The buying list for a project, soonest order-by date first.
   *
   * Items with no date sink to the bottom rather than sorting as if they were due
   * today — an undated line is unplanned, not urgent.
   */
  async schedule(organisationId: string, projectId: string): Promise<Material[]> {
    const settings = await this.settings.get(organisationId);
    await this.projects.assertProject(organisationId, projectId);

    const materials = await this.prisma.material.findMany({
      where: { projectId },
      include: MATERIAL_INCLUDE,
    });

    return materials
      .map((m) => toMaterial(m as MaterialWithRelations, settings))
      .sort((a, b) => {
        if (!a.orderByDate && !b.orderByDate) return a.name.localeCompare(b.name);
        if (!a.orderByDate) return 1;
        if (!b.orderByDate) return -1;
        return a.orderByDate.localeCompare(b.orderByDate);
      });
  }

  /**
   * Suggest an order-by date from a lead time, for the form's "calculate" action.
   * Kept server-side so the suggestion uses the stored handover date.
   */
  async suggestDate(
    organisationId: string,
    projectId: string,
    leadTimeWeeks: number,
  ): Promise<{ orderByDate: string | null; handoverDate: string | null }> {
    const project = await this.projects.assertProject(organisationId, projectId);
    return {
      orderByDate: toIsoDate(suggestOrderByDate(project.handoverDate, leadTimeWeeks)),
      handoverDate: toIsoDate(project.handoverDate),
    };
  }

  /** Materials currently gating a given work item — used by the execution view. */
  async blockingFor(organisationId: string, projectId: string, workItemId: string) {
    const settings = await this.settings.get(organisationId);
    await this.projects.assertProject(organisationId, projectId);

    const materials = await this.prisma.material.findMany({
      where: { projectId, workItemId },
      include: MATERIAL_INCLUDE,
    });

    return materials
      .map((m) => toMaterial(m as MaterialWithRelations, settings))
      .filter((m) => m.isBlocking);
  }
}
