import { Injectable, NotFoundException } from '@nestjs/common';
import {
  parseIsoDate,
  todayUtc,
  type CreateDesignFileDto,
  type DesignFile,
  type UpdateDesignFileDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { ProjectsService } from '../projects/projects.service';
import { toDesignFile, type DesignFileWithRelations } from '../projects/project.mapper';

/**
 * Design → Design Files.
 *
 * Drawings and documents. Deliberately not phase-scoped and with no execution
 * track: a GFC set is issued, never built, so giving it a status of "in progress
 * on site" would be meaningless.
 */
@Injectable()
export class DesignFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

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

    return toDesignFile(file as DesignFileWithRelations);
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
