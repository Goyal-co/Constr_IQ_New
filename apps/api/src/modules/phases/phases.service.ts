import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Phase as PrismaPhase } from '@prisma/client';
import type { Phase, PhaseDto, ReorderDto, UpdatePhaseDto } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';

export function toPhase(row: PrismaPhase, usageCount?: number): Phase {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    position: row.position,
    isArchived: row.isArchived,
    ...(usageCount !== undefined ? { usageCount } : {}),
  };
}

/**
 * Delivery phases — the columns a project's work is organised into.
 *
 * Rows rather than an enum, so an organisation running "Concept / Tender /
 * Construction / Handover" is not fighting a product that insists on
 * "Design / Civil / Finishing".
 */
@Injectable()
export class PhasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organisationId: string, includeArchived = false): Promise<Phase[]> {
    const rows = await this.prisma.phase.findMany({
      where: { organisationId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { workItems: true, materials: true, templateItems: true },
        },
      },
    });

    return rows.map((row) =>
      toPhase(row, row._count.workItems + row._count.materials + row._count.templateItems),
    );
  }

  async create(actor: AuthenticatedUser, dto: PhaseDto, client?: ClientMeta): Promise<Phase> {
    const last = await this.prisma.phase.findFirst({
      where: { organisationId: actor.organisationId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const phase = await this.prisma.phase.create({
      data: {
        organisationId: actor.organisationId,
        name: dto.name,
        colour: dto.colour,
        position: (last?.position ?? -1) + 1,
      },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'phase.created',
      entityType: 'Phase',
      entityId: phase.id,
      entityLabel: phase.name,
      after: { name: phase.name, colour: phase.colour },
      client,
    });

    return toPhase(phase, 0);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdatePhaseDto,
    client?: ClientMeta,
  ): Promise<Phase> {
    const existing = await this.prisma.phase.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!existing) throw new NotFoundException('That phase does not exist.');

    const phase = await this.prisma.phase.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.colour !== undefined ? { colour: dto.colour } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'phase.updated',
      entityType: 'Phase',
      entityId: id,
      entityLabel: phase.name,
      before: { name: existing.name, colour: existing.colour, isArchived: existing.isArchived },
      after: { name: phase.name, colour: phase.colour, isArchived: phase.isArchived },
      client,
    });

    return toPhase(phase);
  }

  /**
   * Delete a phase, but only while nothing points at it.
   *
   * Deleting a phase that a hundred work items reference would either orphan them
   * or cascade away real work, so the caller is told exactly what is in the way
   * and offered archiving instead — which hides it from pickers while leaving
   * history intact.
   */
  async remove(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const phase = await this.prisma.phase.findFirst({
      where: { id, organisationId: actor.organisationId },
      include: {
        _count: {
          select: { workItems: true, materials: true, templateItems: true },
        },
      },
    });
    if (!phase) throw new NotFoundException('That phase does not exist.');

    const inUse = phase._count.workItems + phase._count.materials + phase._count.templateItems;

    if (inUse > 0) {
      throw new ConflictException(
        `"${phase.name}" is used by ${inUse} item${inUse === 1 ? '' : 's'} ` +
          `(${phase._count.workItems} work items, ${phase._count.materials} materials, ` +
          `${phase._count.templateItems} template rows). ` +
          'Archive it instead to hide it from new work while keeping history intact.',
      );
    }

    await this.prisma.phase.delete({ where: { id } });
    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'phase.deleted',
      entityType: 'Phase',
      entityId: id,
      entityLabel: phase.name,
      before: { name: phase.name, colour: phase.colour },
      client,
    });

    return { success: true };
  }

  async reorder(actor: AuthenticatedUser, dto: ReorderDto): Promise<{ success: true }> {
    const owned = await this.prisma.phase.count({
      where: { id: { in: dto.ids }, organisationId: actor.organisationId },
    });
    if (owned !== dto.ids.length)
      throw new NotFoundException('That list includes an unknown phase.');

    await this.prisma.$transaction(
      dto.ids.map((id, position) =>
        this.prisma.phase.update({ where: { id }, data: { position } }),
      ),
    );
    return { success: true };
  }

  /** Resolves a phase id within a tenant. Used by every child service. */
  async assertPhase(organisationId: string, phaseId: string): Promise<PrismaPhase> {
    const phase = await this.prisma.phase.findFirst({ where: { id: phaseId, organisationId } });
    if (!phase) throw new NotFoundException('That phase does not exist in this organisation.');
    return phase;
  }
}
