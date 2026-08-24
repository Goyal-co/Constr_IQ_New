import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category as PrismaCategory } from '@prisma/client';
import type { Category, CategoryDto, ReorderDto } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';

export function toCategory(row: PrismaCategory & { _count?: { projects: number } }): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    position: row.position,
    ...(row._count ? { projectCount: row._count.projects } : {}),
  };
}

/**
 * Project categories — what the original spreadsheet called "offices".
 *
 * Entirely user-defined. The product ships with none, because guessing that a
 * business builds "Marketing Offices" is exactly the kind of assumption that
 * makes software feel like it was written for somebody else.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organisationId: string): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({
      where: { organisationId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      // Deleted projects are excluded so the count matches what the list shows.
      include: { _count: { select: { projects: { where: { deletedAt: null } } } } },
    });
    return rows.map(toCategory);
  }

  async create(actor: AuthenticatedUser, dto: CategoryDto, client?: ClientMeta): Promise<Category> {
    const last = await this.prisma.category.findFirst({
      where: { organisationId: actor.organisationId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const category = await this.prisma.category.create({
      data: {
        organisationId: actor.organisationId,
        name: dto.name,
        description: dto.description ?? null,
        position: (last?.position ?? -1) + 1,
      },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'category.created',
      entityType: 'Category',
      entityId: category.id,
      entityLabel: category.name,
      after: { name: category.name },
      client,
    });

    return { ...toCategory(category), projectCount: 0 };
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: Partial<CategoryDto>,
    client?: ClientMeta,
  ): Promise<Category> {
    const existing = await this.prisma.category.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!existing) throw new NotFoundException('That category does not exist.');

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'category.updated',
      entityType: 'Category',
      entityId: id,
      entityLabel: category.name,
      before: { name: existing.name, description: existing.description },
      after: { name: category.name, description: category.description },
      client,
    });

    return toCategory(category);
  }

  /**
   * Delete a category only while it holds no live projects.
   *
   * The alternative — cascading — would take a dozen projects with it because
   * someone tidied up a list, so the caller is told what is in the way instead.
   */
  async remove(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const category = await this.prisma.category.findFirst({
      where: { id, organisationId: actor.organisationId },
      include: { _count: { select: { projects: { where: { deletedAt: null } } } } },
    });
    if (!category) throw new NotFoundException('That category does not exist.');

    if (category._count.projects > 0) {
      throw new ConflictException(
        `"${category.name}" still holds ${category._count.projects} project` +
          `${category._count.projects === 1 ? '' : 's'}. Move them to another category first.`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'category.deleted',
      entityType: 'Category',
      entityId: id,
      entityLabel: category.name,
      before: { name: category.name },
      client,
    });

    return { success: true };
  }

  async reorder(actor: AuthenticatedUser, dto: ReorderDto): Promise<{ success: true }> {
    const owned = await this.prisma.category.count({
      where: { id: { in: dto.ids }, organisationId: actor.organisationId },
    });
    if (owned !== dto.ids.length) {
      throw new NotFoundException('That list includes an unknown category.');
    }

    await this.prisma.$transaction(
      dto.ids.map((id, position) =>
        this.prisma.category.update({ where: { id }, data: { position } }),
      ),
    );
    return { success: true };
  }
}
