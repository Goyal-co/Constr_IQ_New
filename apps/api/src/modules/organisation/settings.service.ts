import { Injectable, Logger } from '@nestjs/common';
import {
  organisationSettingsSchema,
  withSettingDefaults,
  type Organisation,
  type OrganisationSettings,
  type OrganisationSettingsDto,
  type UpdateOrganisationDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import { AuditService } from '../audit/audit.service';

/** How long a settings snapshot is reused before being re-read. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  settings: OrganisationSettings;
  expiresAt: number;
}

/**
 * Loads the tunable numbers that drive every metric.
 *
 * Read on effectively every request, so a short in-process cache avoids one
 * extra query per call. The TTL is deliberately brief: a settings change should
 * show up across the estate within seconds, and thirty seconds of staleness on a
 * risk threshold is harmless where thirty minutes would be confusing.
 *
 * Multi-replica deployments each hold their own cache, which is fine — they
 * converge within the TTL and no request ever reads a value that was never true.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(organisationId: string): Promise<OrganisationSettings> {
    const cached = this.cache.get(organisationId);
    if (cached && cached.expiresAt > Date.now()) return cached.settings;

    const org = await this.prisma.organisation.findUnique({
      where: { id: organisationId },
      select: { settings: true },
    });

    const settings = withSettingDefaults(
      (org?.settings as Partial<OrganisationSettings> | null) ?? null,
    );
    this.cache.set(organisationId, { settings, expiresAt: Date.now() + CACHE_TTL_MS });
    return settings;
  }

  /** Batch loader for the digest job, which walks every organisation in turn. */
  async getMany(organisationIds: string[]): Promise<Map<string, OrganisationSettings>> {
    const rows = await this.prisma.organisation.findMany({
      where: { id: { in: organisationIds } },
      select: { id: true, settings: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        withSettingDefaults(row.settings as Partial<OrganisationSettings> | null),
      ]),
    );
  }

  /**
   * Merge a partial update over the stored settings.
   *
   * Merge rather than replace, so a form that only renders six of the fifteen
   * settings cannot silently reset the other nine to defaults.
   */
  async update(
    actor: AuthenticatedUser,
    dto: OrganisationSettingsDto,
    client?: ClientMeta,
  ): Promise<OrganisationSettings> {
    const parsed = organisationSettingsSchema.parse(dto);
    const current = await this.get(actor.organisationId);

    const next = withSettingDefaults({
      ...current,
      ...parsed,
      activityStatusWeights: {
        ...current.activityStatusWeights,
        ...(parsed.activityStatusWeights ?? {}),
      },
    });

    await this.prisma.organisation.update({
      where: { id: actor.organisationId },
      data: { settings: next as unknown as object },
    });
    this.cache.delete(actor.organisationId);

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'settings.updated',
      entityType: 'Organisation',
      entityId: actor.organisationId,
      entityLabel: 'Organisation settings',
      before: current as unknown as Record<string, unknown>,
      after: next as unknown as Record<string, unknown>,
      client,
    });

    this.logger.log(`Settings updated for organisation ${actor.organisationId}`);
    return next;
  }

  async getOrganisation(organisationId: string): Promise<Organisation> {
    const org = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: organisationId },
    });
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      createdAt: org.createdAt.toISOString(),
    };
  }

  async updateOrganisation(
    actor: AuthenticatedUser,
    dto: UpdateOrganisationDto,
    client?: ClientMeta,
  ): Promise<Organisation> {
    const before = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: actor.organisationId },
    });

    const org = await this.prisma.organisation.update({
      where: { id: actor.organisationId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
      },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'organisation.updated',
      entityType: 'Organisation',
      entityId: org.id,
      entityLabel: org.name,
      before: { name: before.name, logoUrl: before.logoUrl },
      after: { name: org.name, logoUrl: org.logoUrl },
      client,
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      createdAt: org.createdAt.toISOString(),
    };
  }

  /** Drops a cached snapshot — used by tests and by the seeder. */
  invalidate(organisationId: string): void {
    this.cache.delete(organisationId);
  }
}
