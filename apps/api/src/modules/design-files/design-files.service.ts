import { Injectable, NotFoundException } from '@nestjs/common';
import {
  parseIsoDate,
  todayUtc,
  type CreateCommentDto,
  type CreateDesignFileDto,
  type CreateRevisionDto,
  type DesignFile,
  type UpdateDesignFileDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { ProjectsService } from '../projects/projects.service';
import { toDesignFile, type DesignFileWithRelations } from '../projects/project.mapper';

/**
 * Drawing → Design.
 *
 * Drawings and documents. Deliberately not phase-scoped and with no execution
 * track: a GFC set is issued, never built, so giving it a status of "in progress
 * on site" would be meaningless.
 *
 * It carries comments and revisions on the same terms as a work item, because a
 * drawing set is reissued more often than anything else on a project and "which
 * revision is site building from" is the question this section exists to answer.
 */
@Injectable()
export class DesignFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  /** Re-reads with the full relations, so every mutation returns one shape. */
  private async present(projectId: string, id: string): Promise<DesignFile> {
    const file = await this.prisma.designFile.findFirstOrThrow({
      where: { id, projectId },
      include: {
        completedBy: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
        revisions: { include: { issuedBy: true }, orderBy: { revision: 'desc' } },
      },
    });
    return toDesignFile(file as DesignFileWithRelations);
  }

  private async assertFile(projectId: string, id: string) {
    const file = await this.prisma.designFile.findFirst({ where: { id, projectId } });
    if (!file) throw new NotFoundException('That drawing does not exist on this project.');
    return file;
  }

  // -------------------------------------------------------------------------
  // Comments and revisions
  // -------------------------------------------------------------------------

  async addComment(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: CreateCommentDto,
  ): Promise<DesignFile> {
    await this.projects.assertProject(actor.organisationId, projectId);
    await this.assertFile(projectId, id);

    await this.prisma.activityComment.create({
      data: { designFileId: id, authorId: actor.id, kind: 'NOTE', body: dto.body },
    });

    return this.present(projectId, id);
  }

  /**
   * Issue the next revision of this drawing.
   *
   * The number is assigned inside a transaction rather than sent by the client,
   * so two people clicking at once cannot both produce an R3 — the unique index
   * on (designFileId, revision) is the backstop if they somehow do.
   *
   * Issuing also marks the drawing issued: a revision existing while the file
   * still read "not issued" would contradict itself.
   */
  async addRevision(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: CreateRevisionDto,
    client?: ClientMeta,
  ): Promise<DesignFile> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.assertFile(projectId, id);
    const today = todayUtc();
    const issuedDate = dto.issuedDate === undefined ? today : parseIsoDate(dto.issuedDate);

    const next = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.drawingRevision.findFirst({
        where: { designFileId: id },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      const revision = (latest?.revision ?? 0) + 1;

      await tx.drawingRevision.create({
        data: {
          designFileId: id,
          revision,
          notes: dto.notes ?? null,
          issuedDate,
          issuedById: actor.id,
        },
      });

      await tx.designFile.update({
        where: { id },
        data: {
          currentRevision: revision,
          isComplete: true,
          completedAt: new Date(),
          completedById: actor.id,
          completedDate: issuedDate ?? today,
        },
      });

      if (dto.notes) {
        await tx.activityComment.create({
          data: {
            designFileId: id,
            authorId: actor.id,
            kind: 'REVISION',
            body: `R${revision}: ${dto.notes}`,
          },
        });
      }

      return revision;
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'design_file.revision_issued',
      entityType: 'DesignFile',
      entityId: id,
      entityLabel: `${project.name} · ${existing.name}`,
      before: { currentRevision: existing.currentRevision },
      after: { currentRevision: next, notes: dto.notes ?? null },
      client,
    });

    return this.present(projectId, id);
  }

  async create(
    actor: AuthenticatedUser,
    projectId: string,
    dto: CreateDesignFileDto,
    client?: ClientMeta,
  ): Promise<DesignFile> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);

    const last = await this.prisma.designFile.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const file = await this.prisma.designFile.create({
      data: {
        projectId,
        name: dto.name,
        expectedDate: parseIsoDate(dto.expectedDate ?? null),
        position: (last?.position ?? -1) + 1,
      },
      include: { completedBy: true },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'design_file.created',
      entityType: 'DesignFile',
      entityId: file.id,
      entityLabel: `${project.name} · ${file.name}`,
      after: { name: file.name, expectedDate: file.expectedDate },
      client,
    });

    return toDesignFile(file as DesignFileWithRelations);
  }

  /**
   * Update a design file.
   *
   * Completion is stamped with who and when. That attribution is the difference
   * between a checklist and a record: when a consultant says a GFC set was issued
   * three weeks ago, the log either supports them or does not.
   */
  async update(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    dto: UpdateDesignFileDto,
    client?: ClientMeta,
  ): Promise<DesignFile> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.prisma.designFile.findFirst({ where: { id, projectId } });
    if (!existing) throw new NotFoundException('That design file does not exist on this project.');

    const becameComplete = dto.isComplete === true && !existing.isComplete;
    const becameIncomplete = dto.isComplete === false && existing.isComplete;

    const file = await this.prisma.designFile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isComplete !== undefined ? { isComplete: dto.isComplete } : {}),
        ...(dto.expectedDate !== undefined ? { expectedDate: parseIsoDate(dto.expectedDate) } : {}),
        ...(dto.completedDate !== undefined
          ? { completedDate: parseIsoDate(dto.completedDate) }
          : {}),
        // Stamp the issue date on completion unless the caller supplied one, so a
        // document issued last week keeps its real date rather than today's.
        ...(becameComplete
          ? {
              completedAt: new Date(),
              completedById: actor.id,
              ...(dto.completedDate === undefined ? { completedDate: todayUtc() } : {}),
            }
          : {}),
        ...(becameIncomplete
          ? { completedAt: null, completedById: null, completedDate: null }
          : {}),
      },
      include: { completedBy: true },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: becameComplete
        ? 'design_file.issued'
        : becameIncomplete
          ? 'design_file.reopened'
          : 'design_file.updated',
      entityType: 'DesignFile',
      entityId: id,
      entityLabel: `${project.name} · ${file.name}`,
      before: {
        name: existing.name,
        isComplete: existing.isComplete,
        expectedDate: existing.expectedDate,
        completedDate: existing.completedDate,
      },
      after: {
        name: file.name,
        isComplete: file.isComplete,
        expectedDate: file.expectedDate,
        completedDate: file.completedDate,
      },
      client,
    });

    // A note supplied with the change is stored against the approval it
    // explains, so "why was this signed off" is answerable from the drawing
    // itself rather than from somebody's memory.
    if (dto.comment) {
      await this.prisma.activityComment.create({
        data: {
          designFileId: id,
          authorId: actor.id,
          kind:
            dto.isComplete !== undefined && dto.isComplete !== existing.isComplete
              ? 'DESIGN_APPROVAL'
              : 'NOTE',
          body: dto.comment,
        },
      });
    }

    // Re-read rather than mapping `file`: that row was fetched before the
    // comment was written, so returning it would drop a note the caller just
    // made until the next refetch.
    return this.present(projectId, id);
  }

  /** Tick or untick every design file at once. */
  async setAll(
    actor: AuthenticatedUser,
    projectId: string,
    isComplete: boolean,
    client?: ClientMeta,
  ): Promise<{ updated: number }> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);

    const { count } = await this.prisma.designFile.updateMany({
      where: { projectId, isComplete: !isComplete },
      data: {
        isComplete,
        completedAt: isComplete ? new Date() : null,
        completedDate: isComplete ? todayUtc() : null,
        completedById: isComplete ? actor.id : null,
      },
    });

    if (count > 0) {
      await this.audit.record({
        organisationId: actor.organisationId,
        actorId: actor.id,
        action: isComplete ? 'design_file.bulk_issued' : 'design_file.bulk_reopened',
        entityType: 'Project',
        entityId: projectId,
        entityLabel: `${project.name} · design files`,
        after: { isComplete, count },
        client,
      });
    }

    return { updated: count };
  }

  async remove(
    actor: AuthenticatedUser,
    projectId: string,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const project = await this.projects.assertProject(actor.organisationId, projectId);
    const existing = await this.prisma.designFile.findFirst({ where: { id, projectId } });
    if (!existing) throw new NotFoundException('That design file does not exist on this project.');

    await this.prisma.designFile.delete({ where: { id } });
    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'design_file.deleted',
      entityType: 'DesignFile',
      entityId: id,
      entityLabel: `${project.name} · ${existing.name}`,
      before: { name: existing.name, isComplete: existing.isComplete },
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
    const owned = await this.prisma.designFile.count({ where: { id: { in: ids }, projectId } });
    if (owned !== ids.length) throw new NotFoundException('That list includes an unknown file.');

    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.designFile.update({ where: { id }, data: { position } }),
      ),
    );
    return { success: true };
  }
}
