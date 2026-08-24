import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Prisma,
  TemplateItem as PrismaTemplateItem,
  Template as PrismaTemplate,
  Phase as PrismaPhase,
} from '@prisma/client';
import type {
  Template,
  TemplateDetail,
  TemplateDto,
  TemplateItem,
  TemplateItemsDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { toPhase } from '../phases/phases.service';

type TemplateItemWithPhase = PrismaTemplateItem & { phase: PrismaPhase | null };

function toTemplateItem(row: TemplateItemWithPhase): TemplateItem {
  return {
    id: row.id,
    kind: row.kind,
    phase: row.phase ? toPhase(row.phase) : null,
    name: row.name,
    position: row.position,
    leadTimeWeeks: row.leadTimeWeeks,
    offsetStartDays: row.offsetStartDays,
    offsetEndDays: row.offsetEndDays,
  };
}

function toTemplate(row: PrismaTemplate & { _count?: { items: number } }): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    itemCount: row._count?.items ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Project playbooks.
 *
 * A template is the replacement for what used to be a hard-coded checklist in the
 * source. An organisation builds as many as it needs — a marketing suite, a
 * clubhouse, a two-week mock-up — each with its own drawings, activities and
 * materials, and each attached to phases the same organisation defined.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organisationId: string): Promise<Template[]> {
    const rows = await this.prisma.template.findMany({
      where: { organisationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
    return rows.map(toTemplate);
  }

  async findOne(organisationId: string, id: string): Promise<TemplateDetail> {
    const row = await this.prisma.template.findFirst({
      where: { id, organisationId },
      include: {
        _count: { select: { items: true } },
        items: {
          include: { phase: true },
          orderBy: [{ kind: 'asc' }, { position: 'asc' }],
        },
      },
    });
    if (!row) throw new NotFoundException('That template does not exist.');

    return { ...toTemplate(row), items: row.items.map(toTemplateItem) };
  }

  async create(
    actor: AuthenticatedUser,
    dto: TemplateDto,
    client?: ClientMeta,
  ): Promise<TemplateDetail> {
    const template = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, actor.organisationId);
      return tx.template.create({
        data: {
          organisationId: actor.organisationId,
          name: dto.name,
          description: dto.description ?? null,
          isDefault: dto.isDefault,
        },
      });
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'template.created',
      entityType: 'Template',
      entityId: template.id,
      entityLabel: template.name,
      after: { name: template.name, isDefault: template.isDefault },
      client,
    });

    return this.findOne(actor.organisationId, template.id);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: Partial<TemplateDto>,
    client?: ClientMeta,
  ): Promise<TemplateDetail> {
    const existing = await this.prisma.template.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!existing) throw new NotFoundException('That template does not exist.');

    await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, actor.organisationId, id);
      await tx.template.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'template.updated',
      entityType: 'Template',
      entityId: id,
      entityLabel: dto.name ?? existing.name,
      before: {
        name: existing.name,
        description: existing.description,
        isDefault: existing.isDefault,
      },
      after: {
        name: dto.name ?? existing.name,
        description: dto.description ?? existing.description,
        isDefault: dto.isDefault ?? existing.isDefault,
      },
      client,
    });

    return this.findOne(actor.organisationId, id);
  }

  /**
   * Replace a template's items wholesale.
   *
   * Templates are edited as a list in one screen, so a single atomic replace is
   * both simpler and safer than diffing individual rows — there is no window in
   * which the template is half-updated.
   */
  async setItems(
    actor: AuthenticatedUser,
    id: string,
    dto: TemplateItemsDto,
    client?: ClientMeta,
  ): Promise<TemplateDetail> {
    const template = await this.prisma.template.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!template) throw new NotFoundException('That template does not exist.');

    // Design files carry no phase, so only the phase-scoped kinds are checked.
    const phaseIds = [
      ...new Set(dto.items.map((i) => i.phaseId).filter((v): v is string => Boolean(v))),
    ];
    if (phaseIds.length > 0) {
      const known = await this.prisma.phase.count({
        where: { id: { in: phaseIds }, organisationId: actor.organisationId },
      });
      if (known !== phaseIds.length) {
        throw new BadRequestException('One or more items reference a phase that does not exist.');
      }
    }

    for (const item of dto.items) {
      // A work item or material with no phase could never be placed under a
      // section, so it is rejected here rather than silently dropped on apply.
      if (item.kind !== 'DESIGN_FILE' && !item.phaseId) {
        throw new BadRequestException(
          `"${item.name}" is a ${item.kind === 'WORK_ITEM' ? 'work item' : 'material'} and needs a phase.`,
        );
      }
    }

    // Positions are assigned per kind so each checklist numbers from zero.
    const counters = new Map<string, number>();
    const data = dto.items.map((item) => {
      const key = `${item.kind}`;
      const position = counters.get(key) ?? 0;
      counters.set(key, position + 1);
      return {
        templateId: id,
        phaseId: item.kind === 'DESIGN_FILE' ? null : (item.phaseId ?? null),
        kind: item.kind,
        name: item.name,
        position,
        leadTimeWeeks: item.kind === 'MATERIAL' ? (item.leadTimeWeeks ?? null) : null,
        offsetStartDays: item.kind === 'WORK_ITEM' ? (item.offsetStartDays ?? null) : null,
        offsetEndDays: item.kind === 'WORK_ITEM' ? (item.offsetEndDays ?? null) : null,
      };
    });

    const previousCount = await this.prisma.templateItem.count({ where: { templateId: id } });

    await this.prisma.$transaction([
      this.prisma.templateItem.deleteMany({ where: { templateId: id } }),
      ...(data.length > 0 ? [this.prisma.templateItem.createMany({ data })] : []),
      this.prisma.template.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'template.items_replaced',
      entityType: 'Template',
      entityId: id,
      entityLabel: template.name,
      before: { itemCount: previousCount },
      after: { itemCount: data.length },
      client,
    });

    return this.findOne(actor.organisationId, id);
  }

  async remove(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const template = await this.prisma.template.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!template) throw new NotFoundException('That template does not exist.');

    // Items cascade; projects already created from this template are untouched,
    // because applying a template copies rows rather than linking to it.
    await this.prisma.template.delete({ where: { id } });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'template.deleted',
      entityType: 'Template',
      entityId: id,
      entityLabel: template.name,
      before: { name: template.name },
      client,
    });

    return { success: true };
  }

  /** Duplicates a template and its items — the usual way a new playbook starts. */
  async duplicate(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<TemplateDetail> {
    const source = await this.prisma.template.findFirst({
      where: { id, organisationId: actor.organisationId },
      include: { items: true },
    });
    if (!source) throw new NotFoundException('That template does not exist.');

    const copy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.template.create({
        data: {
          organisationId: actor.organisationId,
          name: await this.uniqueName(tx, actor.organisationId, `${source.name} (copy)`),
          description: source.description,
          isDefault: false,
        },
      });
      if (source.items.length > 0) {
        await tx.templateItem.createMany({
          data: source.items.map((item) => ({
            templateId: created.id,
            phaseId: item.phaseId,
            kind: item.kind,
            name: item.name,
            position: item.position,
            leadTimeWeeks: item.leadTimeWeeks,
            offsetStartDays: item.offsetStartDays,
            offsetEndDays: item.offsetEndDays,
          })),
        });
      }
      return created;
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'template.duplicated',
      entityType: 'Template',
      entityId: copy.id,
      entityLabel: copy.name,
      after: { name: copy.name, copiedFrom: source.name, itemCount: source.items.length },
      client,
    });

    return this.findOne(actor.organisationId, copy.id);
  }

  /** Loads a template's items for ProjectsService when applying it to a project. */
  async itemsFor(organisationId: string, templateId: string): Promise<TemplateItemWithPhase[]> {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, organisationId },
      include: {
        items: { include: { phase: true }, orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
      },
    });
    if (!template) throw new BadRequestException('That template does not exist.');
    return template.items;
  }

  async defaultTemplateId(organisationId: string): Promise<string | null> {
    const row = await this.prisma.template.findFirst({
      where: { organisationId, isDefault: true },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async clearDefault(
    tx: Prisma.TransactionClient,
    organisationId: string,
    exceptId?: string,
  ): Promise<void> {
    await tx.template.updateMany({
      where: { organisationId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }

  /** Appends " 2", " 3"… until the name is free, since names are unique per tenant. */
  private async uniqueName(
    tx: Prisma.TransactionClient,
    organisationId: string,
    base: string,
  ): Promise<string> {
    let candidate = base.slice(0, 120);
    let suffix = 2;
    while (await tx.template.findFirst({ where: { organisationId, name: candidate } })) {
      candidate = `${base.slice(0, 114)} ${suffix++}`;
    }
    return candidate;
  }
}
