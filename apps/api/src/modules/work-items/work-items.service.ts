import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVITY_STATUS_LABELS,
  computeSlippage,
  evaluateExecutionGate,
  isProgressStatus,
  isSlipping,
  parseIsoDate,
  todayUtc,
  type BulkDesignDto,
  type CreateWorkItemDto,
  type MaterialStatus,
  type UpdateWorkItemDto,
  type WorkItem,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../organisation/settings.service';
import { PhasesService } from '../phases/phases.service';
import { ProjectsService } from '../projects/projects.service';
import { toWorkItem, type WorkItemWithRelations } from '../projects/project.mapper';

/**
 * Work items — the rows behind both Design → {phase} and Execution → {phase}.
 *
 * One record with two independent completion tracks. Adding an item under
 * Design → Civil makes it appear under Execution → Civil in the same breath,
 * because there is no second row to synchronise.
 */
@Injectable()
export class WorkItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly phases: PhasesService,
    private readonly projects: ProjectsService,
    private readonly settings: SettingsService,
  ) {}

  private async load(projectId: string, id: string) {
    const item = await this.prisma.workItem.findFirst({
      where: { id, projectId },
      include: { phase: true, assignee: true, designedBy: true },
    });
    if (!item) throw new NotFoundException('That work item does not exist on this project.');
    return item;
  }

  /** All materials on the project — needed to resolve gating on any response. */
  private materialsFor(projectId: string) {
    return this.prisma.material.findMany({ where: { projectId } });
  }

  async create(
    actor: AuthenticatedUser,
    projectId: string,
    dto: CreateWorkItemDto,
    client?: ClientMeta,
  ): Promise<WorkItem> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const phase = await this.phases.assertPhase(actor.organisationId, dto.phaseId);
    if (dto.assigneeId) await this.assertAssignee(actor.organisationId, dto.assigneeId);

    const last = await this.prisma.workItem.findFirst({
      where: { projectId, phaseId: dto.phaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const item = await this.prisma.workItem.create({
      data: {
        projectId,
        phaseId: dto.phaseId,
        name: dto.name,
        designExpectedDate: parseIsoDate(dto.designExpectedDate ?? null),
        plannedStart: parseIsoDate(dto.plannedStart ?? null),
        plannedEnd: parseIsoDate(dto.plannedEnd ?? null),
        assigneeId: dto.assigneeId ?? null,
        position: (last?.position ?? -1) + 1,
      },
      include: { phase: true, assignee: true, designedBy: true },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'work_item.created',
      entityType: 'WorkItem',
      entityId: item.id,
      entityLabel: `${project.name} · ${item.name}`,
      after: { name: item.name, phase: phase.name, plannedEnd: item.plannedEnd },
      client,
    });

    const settings = await this.settings.get(actor.organisationId);
    return toWorkItem(item as WorkItemWithRelations, [], settings);
  }

  /**
   * Update either track.
   *
   * Both live on one endpoint because they live on one row. The Design view sends
   * `designComplete`; the Execution view sends status and dates. Splitting them
   * across two routes would invite the two views to drift.
   */
  async update(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: UpdateWorkItemDto,
    client?: ClientMeta,
  ): Promise<WorkItem> {
    const settings = await this.settings.get(actor.organisationId);
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.load(projectId, id);

    if (dto.phaseId) await this.phases.assertPhase(actor.organisationId, dto.phaseId);
    if (dto.assigneeId) await this.assertAssignee(actor.organisationId, dto.assigneeId);

    const materials = await this.materialsFor(projectId);
    const today = todayUtc();

    // ----- The execution gate ------------------------------------------------
    // Site work may only start or finish once the design has been issued AND
    // every linked material has arrived. Enforced here rather than only in the
    // interface, because a disabled dropdown is a suggestion and this is a rule.
    if (
      dto.executionStatus !== undefined &&
      isProgressStatus(dto.executionStatus) &&
      dto.executionStatus !== existing.executionStatus
    ) {
      const gate = evaluateExecutionGate(
        {
          id,
          designComplete: dto.designComplete ?? existing.designComplete,
          executionStatus: existing.executionStatus,
          plannedEnd: existing.plannedEnd,
          actualEnd: existing.actualEnd,
        },
        materials.map((m) => ({
          id: m.id,
          status: m.status as MaterialStatus,
          orderByDate: m.orderByDate,
          workItemId: m.workItemId,
        })),
      );

      if (!gate.canStart) {
        const pending = materials.filter((m) => gate.pendingMaterialIds.includes(m.id));
        const verb = ACTIVITY_STATUS_LABELS[dto.executionStatus].toLowerCase();
        throw new ConflictException({
          statusCode: 409,
          error: 'Blocked',
          message:
            `"${existing.name}" cannot be marked ${verb} yet — ${gate.reasons.join(' and ')}.` +
            (pending.length > 0 ? ` Waiting on: ${pending.map((m) => m.name).join(', ')}.` : ''),
          details: {
            designPending: gate.designPending,
            blockingMaterials: pending.map((m) => m.name),
          },
        });
      }
    }

    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phaseId !== undefined) data.phaseId = dto.phaseId;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
    if (dto.plannedStart !== undefined) data.plannedStart = parseIsoDate(dto.plannedStart);
    if (dto.plannedEnd !== undefined) data.plannedEnd = parseIsoDate(dto.plannedEnd);
    if (dto.actualStart !== undefined) data.actualStart = parseIsoDate(dto.actualStart);
    if (dto.actualEnd !== undefined) data.actualEnd = parseIsoDate(dto.actualEnd);

    // --- Design track --------------------------------------------------------
    if (dto.designExpectedDate !== undefined) {
      data.designExpectedDate = parseIsoDate(dto.designExpectedDate);
    }
    if (dto.designCompletedDate !== undefined) {
      data.designCompletedDate = parseIsoDate(dto.designCompletedDate);
    }
    if (dto.designComplete !== undefined) {
      data.designComplete = dto.designComplete;
      data.designCompletedAt = dto.designComplete ? new Date() : null;
      data.designedById = dto.designComplete ? actor.id : null;
      // Stamp the issue date on completion unless the caller supplied one, so a
      // drawing issued last week can still be recorded with its real date.
      if (dto.designComplete && dto.designCompletedDate === undefined) {
        data.designCompletedDate = today;
      }
      if (!dto.designComplete) data.designCompletedDate = null;
    }

    // --- Execution track -----------------------------------------------------
    if (dto.executionStatus !== undefined) {
      data.executionStatus = dto.executionStatus;
      if (dto.executionStatus === 'DONE' && !existing.actualEnd && dto.actualEnd === undefined) {
        // Stamp today, but never earlier than the recorded start. An item started
        // against a future planned date would otherwise fail validation on a
        // date the person completing it never entered.
        const start = (data.actualStart as Date | null) ?? existing.actualStart;
        data.actualEnd = start && start > today ? start : today;
      }
      if (
        dto.executionStatus === 'IN_PROGRESS' &&
        !existing.actualStart &&
        dto.actualStart === undefined
      ) {
        data.actualStart = today;
      }
      if (dto.executionStatus === 'NOT_STARTED') {
        data.actualStart = null;
        data.actualEnd = null;
      }
    } else if (dto.actualEnd && existing.executionStatus !== 'DONE') {
      // An actual end date implies completion — but the gate still applies, so
      // the date is recorded and the status simply does not advance.
      const gate = evaluateExecutionGate(
        {
          id,
          designComplete: dto.designComplete ?? existing.designComplete,
          executionStatus: existing.executionStatus,
          plannedEnd: existing.plannedEnd,
          actualEnd: existing.actualEnd,
        },
        materials.map((m) => ({
          id: m.id,
          status: m.status as MaterialStatus,
          orderByDate: m.orderByDate,
          workItemId: m.workItemId,
        })),
      );
      if (gate.canComplete) data.executionStatus = 'DONE';
    }

    // Cross-field validation against stored values, which the DTO schema cannot
    // see when only one of a pair is being patched.
    const plannedStart = (data.plannedStart as Date | null) ?? existing.plannedStart;
    const plannedEnd = (data.plannedEnd as Date | null) ?? existing.plannedEnd;
    if (plannedStart && plannedEnd && plannedStart > plannedEnd) {
      throw new BadRequestException('Planned start must fall on or before planned end.');
    }
    const actualStart = (data.actualStart as Date | null) ?? existing.actualStart;
    const actualEnd = (data.actualEnd as Date | null) ?? existing.actualEnd;
    if (actualStart && actualEnd && actualStart > actualEnd) {
      throw new BadRequestException('Actual start must fall on or before actual end.');
    }

    const item = await this.prisma.workItem.update({
      where: { id },
      data,
      include: { phase: true, assignee: true, designedBy: true },
    });

    const before = computeSlippage(
      {
        designComplete: existing.designComplete,
        executionStatus: existing.executionStatus,
        plannedEnd: existing.plannedEnd,
        actualEnd: existing.actualEnd,
      },
      today,
    );
    const after = computeSlippage(
      {
        designComplete: item.designComplete,
        executionStatus: item.executionStatus,
        plannedEnd: item.plannedEnd,
        actualEnd: item.actualEnd,
      },
      today,
    );

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: this.actionFor(dto, existing.designComplete, existing.executionStatus),
      entityType: 'WorkItem',
      entityId: id,
      entityLabel: `${project.name} · ${item.name}`,
      before: {
        name: existing.name,
        designComplete: existing.designComplete,
        executionStatus: existing.executionStatus,
        plannedStart: existing.plannedStart,
        plannedEnd: existing.plannedEnd,
        actualStart: existing.actualStart,
        actualEnd: existing.actualEnd,
        assigneeId: existing.assigneeId,
        slippageDays: before?.days ?? null,
      },
      after: {
        name: item.name,
        designComplete: item.designComplete,
        executionStatus: item.executionStatus,
        plannedStart: item.plannedStart,
        plannedEnd: item.plannedEnd,
        actualStart: item.actualStart,
        actualEnd: item.actualEnd,
        assigneeId: item.assigneeId,
        slippageDays: after?.days ?? null,
      },
      client,
    });

    // Tell the manager the moment an item crosses into blocked or late, rather
    // than waiting for them to notice it on the report.
    const startedSlipping = !isSlipping(before) && isSlipping(after);
    if (
      (startedSlipping || dto.executionStatus === 'BLOCKED') &&
      project.managerId &&
      project.managerId !== actor.id
    ) {
      await this.notifications.push({
        organisationId: actor.organisationId,
        userId: project.managerId,
        kind: 'ACTIVITY_SLIPPED',
        title: `${item.name} is behind plan`,
        body:
          dto.executionStatus === 'BLOCKED'
            ? `${actor.name} marked this blocked on ${project.name}.`
            : `${item.name} on ${project.name} is ${after?.days ?? 0} days past its planned end.`,
        projectId,
        dedupeKey: `work-item-slip:${id}`,
      });
    }

    return toWorkItem(item as WorkItemWithRelations, materials, settings);
  }

  private actionFor(dto: UpdateWorkItemDto, wasDesigned: boolean, wasStatus: string): string {
    if (dto.designComplete === true && !wasDesigned) return 'work_item.design_issued';
    if (dto.designComplete === false && wasDesigned) return 'work_item.design_reopened';
    if (dto.executionStatus === 'DONE' && wasStatus !== 'DONE') return 'work_item.completed';
    if (dto.executionStatus === 'BLOCKED' && wasStatus !== 'BLOCKED') return 'work_item.blocked';
    return 'work_item.updated';
  }

  /** Tick or untick the design track for a whole phase — the "mark all" control. */
  async setPhaseDesign(
    actor: AuthenticatedUser,
    projectId: string,
    dto: BulkDesignDto,
    client?: ClientMeta,
  ): Promise<{ updated: number }> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const phase = await this.phases.assertPhase(actor.organisationId, dto.phaseId);

    const { count } = await this.prisma.workItem.updateMany({
      where: { projectId, phaseId: dto.phaseId, designComplete: !dto.designComplete },
      data: {
        designComplete: dto.designComplete,
        designCompletedAt: dto.designComplete ? new Date() : null,
        designCompletedDate: dto.designComplete ? todayUtc() : null,
        designedById: dto.designComplete ? actor.id : null,
      },
    });

    if (count > 0) {
      await this.audit.record({
        organisationId: actor.organisationId,
        actorId: actor.id,
        action: dto.designComplete
          ? 'work_item.bulk_design_issued'
          : 'work_item.bulk_design_reopened',
        entityType: 'Project',
        entityId: projectId,
        entityLabel: `${project.name} · ${phase.name} design`,
        after: { phase: phase.name, designComplete: dto.designComplete, count },
        client,
      });
    }

    return { updated: count };
  }

  /**
   * Delete a work item.
   *
   * Any material linked to it has its link nulled by the schema rather than being
   * deleted — a purchase record must outlive the activity it was raised for.
   */
  async remove(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.load(projectId, id);

    const linkedCount = await this.prisma.material.count({ where: { workItemId: id } });

    await this.prisma.workItem.delete({ where: { id } });
    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'work_item.deleted',
      entityType: 'WorkItem',
      entityId: id,
      entityLabel: `${project.name} · ${existing.name}`,
      before: {
        name: existing.name,
        phase: existing.phase.name,
        executionStatus: existing.executionStatus,
        unlinkedMaterials: linkedCount,
      },
      client,
    });
    return { success: true };
  }

  async reorder(
    actor: AuthenticatedUser,
    projectId: string,
    ids: string[],
  ): Promise<{ success: true }> {
    await this.projects.assertProject(actor.organisationId, projectId);
    const owned = await this.prisma.workItem.count({ where: { id: { in: ids }, projectId } });
    if (owned !== ids.length) throw new NotFoundException('That list includes an unknown item.');

    await this.prisma.$transaction(
      ids.map((id, position) => this.prisma.workItem.update({ where: { id }, data: { position } })),
    );
    return { success: true };
  }

  private async assertAssignee(organisationId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organisationId, isActive: true },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('That user is not an active member of this organisation.');
    }
  }
}
