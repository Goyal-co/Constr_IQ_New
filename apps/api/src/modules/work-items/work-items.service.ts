import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVITY_STATUS_LABELS,
  formatDate,
  computeSlippage,
  evaluateExecutionGate,
  isProgressStatus,
  isSlipping,
  parseIsoDate,
  todayUtc,
  type BulkDesignDto,
  type CloseRevisionDto,
  type CommentKind,
  type CreateCommentDto,
  type CreateRevisionDto,
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

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  /**
   * Add a standalone comment.
   *
   * Comments attached to a change go through `update` instead, so the note and
   * the transition it explains commit together. This route is for the ordinary
   * case of somebody saying something about an activity.
   */
  async addComment(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: CreateCommentDto,
  ): Promise<WorkItem> {
    await this.projects.assertProject(actor.organisationId, projectId);
    await this.load(projectId, id);

    await this.prisma.activityComment.create({
      data: { workItemId: id, authorId: actor.id, kind: 'NOTE', body: dto.body },
    });

    return this.present(actor, projectId, id);
  }

  // -------------------------------------------------------------------------
  // Drawing revisions
  // -------------------------------------------------------------------------

  /**
   * Raise a revision.
   *
   * Opening and issuing are separate acts. A revision is raised when somebody
   * decides the drawing must change; the new sheet lands days or weeks later.
   * Collapsing the two into one event lost that gap — and the gap is the period
   * site knows a change is coming and has nothing to build from, which is
   * exactly what anybody looking at this screen wants to see.
   *
   * The number is assigned here, inside a transaction, rather than sent by the
   * client: two people clicking at the same moment must not both produce an R3.
   * The unique index on (owner, revision) is the backstop if they do.
   *
   * Raising does NOT mark the drawing issued. It is being revised, which is the
   * opposite of ready.
   */
  async openRevision(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: CreateRevisionDto,
    client?: ClientMeta,
  ) {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.load(projectId, id);

    // One at a time. Two open revisions on one drawing would leave "which
    // revision is site building from" with no answer, which is the question
    // this whole feature exists to settle.
    const alreadyOpen = await this.prisma.drawingRevision.findFirst({
      where: { workItemId: id, status: 'OPEN' },
    });
    if (alreadyOpen) {
      throw new ConflictException(
        `R${alreadyOpen.revision} is already open on "${existing.name}". Close it before raising another.`,
      );
    }

    const raisedOn = todayUtc();

    const revision = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.drawingRevision.findFirst({
        where: { workItemId: id },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      const next = (latest?.revision ?? 0) + 1;

      await tx.drawingRevision.create({
        data: {
          workItemId: id,
          revision: next,
          status: 'OPEN',
          notes: dto.notes ?? null,
          openedById: actor.id,
        },
      });

      // Raising a revision un-issues the item.
      //
      // The drawing on site is now known to be wrong, so the honest state is
      // "not issued" until the replacement lands — and because the execution
      // gate keys off exactly this flag, site work on it stops too. That is the
      // point: building to a superseded drawing is the failure this whole
      // section exists to prevent.
      //
      // The old issue date goes with it. It survives on the revision that
      // carried it, which is where the history belongs.
      await tx.workItem.update({
        where: { id },
        data: {
          designComplete: false,
          designCompletedAt: null,
          designedById: null,
          designCompletedDate: null,
        },
      });

      // Logged whether or not a reason was given: the thread is the record of
      // when this drawing went out of service, and a revision raised silently
      // would leave that gap unexplained.
      await tx.activityComment.create({
        data: {
          workItemId: id,
          authorId: actor.id,
          kind: 'REVISION',
          body: dto.notes
            ? `R${next} opened ${formatDate(raisedOn)} — ${dto.notes}`
            : `R${next} opened ${formatDate(raisedOn)}.`,
        },
      });

      return next;
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'workitem.revision_opened',
      entityType: 'WorkItem',
      entityId: id,
      entityLabel: `${project.name} · ${existing.name}`,
      before: { openRevision: null },
      after: { openRevision: revision, notes: dto.notes ?? null },
      client,
    });

    return this.present(actor, projectId, id);
  }

  /**
   * Close a revision out — the reissued drawing has landed.
   *
   * Only now does the parent count as issued, and only now does
   * `currentRevision` move: it tracks what site can build from, not what
   * somebody has started drawing.
   */
  async closeRevision(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    revisionId: string,
    dto: CloseRevisionDto,
    client?: ClientMeta,
  ) {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.load(projectId, id);

    const revision = await this.prisma.drawingRevision.findFirst({
      where: { id: revisionId, workItemId: id },
    });
    if (!revision) {
      throw new NotFoundException('That revision does not exist on this item.');
    }
    if (revision.status === 'ISSUED') {
      throw new ConflictException(`R${revision.revision} has already been issued.`);
    }

    const issued = dto.issuedDate === undefined ? todayUtc() : parseIsoDate(dto.issuedDate);
    // The check constraint requires a date on an issued revision, and today is
    // the only sensible fallback if the caller cleared it.
    const issuedOn = issued ?? todayUtc();

    await this.prisma.$transaction(async (tx) => {
      await tx.drawingRevision.update({
        where: { id: revisionId },
        data: {
          status: 'ISSUED',
          issuedDate: issuedOn,
          issuedById: actor.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      });

      await tx.workItem.update({
        where: { id },
        data: {
          currentRevision: revision.revision,
          designComplete: true,
          designCompletedAt: new Date(),
          designedById: actor.id,
          designCompletedDate: issuedOn,
        },
      });

      // The issue date, not today's: a sheet issued last week and recorded now
      // must read as issued last week, and the comment is where somebody looks
      // for that rather than the audit log.
      await tx.activityComment.create({
        data: {
          workItemId: id,
          authorId: actor.id,
          kind: 'REVISION',
          body: dto.notes
            ? `R${revision.revision} closed ${formatDate(issuedOn)} — ${dto.notes}`
            : `R${revision.revision} closed ${formatDate(issuedOn)}.`,
        },
      });
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'workitem.revision_issued',
      entityType: 'WorkItem',
      entityId: id,
      entityLabel: `${project.name} · ${existing.name}`,
      before: { currentRevision: existing.currentRevision },
      after: { currentRevision: revision.revision },
      client,
    });

    return this.present(actor, projectId, id);
  }

  /** Re-reads an item and maps it, so every mutation returns the same shape. */
  private async present(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
  ): Promise<WorkItem> {
    const [item, materials, settings] = await Promise.all([
      this.prisma.workItem.findFirstOrThrow({
        where: { id, projectId },
        include: {
          phase: true,
          assignee: true,
          designedBy: true,
          comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
          revisions: {
            include: { issuedBy: true, openedBy: true },
            orderBy: { revision: 'desc' },
          },
        },
      }),
      this.materialsFor(projectId),
      this.settings.get(actor.organisationId),
    ]);
    return toWorkItem(item as WorkItemWithRelations, materials, settings, new Map(), todayUtc());
  }

  /**
   * Refuses to mark something issued while a revision is open on it.
   *
   * Un-issuing at the moment a revision is raised is not enough on its own: the
   * checkbox is still there, and so is "mark all issued". Without this an item
   * could sit issued and under revision at the same time — which is the exact
   * contradiction the open/close lifecycle exists to prevent, and it would put
   * a superseded drawing back in front of site.
   *
   * Closing the revision is the only route to issued.
   */
  private async assertNoOpenRevision(workItemId: string, name: string) {
    const open = await this.prisma.drawingRevision.findFirst({
      where: { workItemId, status: 'OPEN' },
      select: { revision: true },
    });
    if (open) {
      throw new ConflictException(
        `"${name}" is under revision — R${open.revision} is open. Close that revision to issue it.`,
      );
    }
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
    // Settings are not fetched here: the response is built by `present`, which
    // reads them itself. Fetching them twice per update would be waste.
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.load(projectId, id);

    if (dto.phaseId) await this.phases.assertPhase(actor.organisationId, dto.phaseId);
    if (dto.assigneeId) await this.assertAssignee(actor.organisationId, dto.assigneeId);
    if (dto.designComplete === true && !existing.designComplete) {
      await this.assertNoOpenRevision(id, existing.name);
    }

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

    // A note supplied with the change is stored against the transition it
    // explains, so "why did this slip" is answerable from the activity itself
    // rather than by correlating the audit log against someone's memory.
    if (dto.comment) {
      const statusChanged =
        dto.executionStatus !== undefined && dto.executionStatus !== existing.executionStatus;
      const designChanged =
        dto.designComplete !== undefined && dto.designComplete !== existing.designComplete;

      const kind: CommentKind = statusChanged
        ? 'STATUS_CHANGE'
        : designChanged
          ? 'DESIGN_APPROVAL'
          : 'NOTE';

      await this.prisma.activityComment.create({
        data: {
          workItemId: id,
          authorId: actor.id,
          kind,
          body: dto.comment,
          statusFrom: statusChanged ? existing.executionStatus : null,
          statusTo: statusChanged ? (dto.executionStatus as string) : null,
        },
      });
    }

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

    // Re-read rather than mapping `item`: that row was fetched before the
    // comment was written, so returning it would drop a note the caller just
    // made and the interface would show the change with no reason attached
    // until the next refetch.
    return this.present(actor, projectId, id);
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
      where: {
        projectId,
        phaseId: dto.phaseId,
        designComplete: !dto.designComplete,
        // Items under revision are skipped rather than refused: "mark all issued"
        // is a convenience across a whole phase, and failing the lot because one
        // drawing is mid-revision would be worse than quietly leaving that one
        // out. It stays un-issued, which is the truth about it, and the caller is
        // told how many were actually changed.
        ...(dto.designComplete ? { revisions: { none: { status: 'OPEN' } } } : {}),
      },
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
