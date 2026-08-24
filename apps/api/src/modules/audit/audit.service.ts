import { Injectable, Logger } from '@nestjs/common';
import type { AuditQueryDto, AuditChange, AuditEntry, Paginated } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClientMeta } from '../../common/auth-context';
import { toUserSummary } from '../users/user.mapper';

/** Fields that must never be written into the audit trail, even as a diff. */
const REDACTED_FIELDS = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'secret',
]);

export interface AuditInput {
  organisationId: string;
  actorId?: string | null;
  /** Verb in past tense, dotted: `project.created`, `material.ordered`. */
  action: string;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  client?: ClientMeta;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write one audit entry.
   *
   * Never throws. An audit write failing must not roll back the business action
   * that succeeded — a lost log line is bad, a user losing their work because
   * logging broke is worse. Failures are logged loudly for alerting instead.
   */
  async record(input: AuditInput): Promise<void> {
    try {
      const changes = diffRecords(input.before ?? null, input.after ?? null);

      // Skip no-op updates: a PATCH that changed nothing is noise that buries the
      // entries someone actually needs to find.
      if (input.before && input.after && changes.length === 0) return;

      await this.prisma.auditLog.create({
        data: {
          organisationId: input.organisationId,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          entityLabel: input.entityLabel?.slice(0, 300) ?? null,
          changes: changes.length > 0 ? (changes as unknown as object) : undefined,
          ipAddress: input.client?.ipAddress ?? null,
          userAgent: input.client?.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${input.action} for ${input.entityType}:${input.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Records several entries in one round trip — used by bulk operations. */
  async recordMany(inputs: AuditInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await this.prisma.auditLog.createMany({
        data: inputs.map((input) => {
          const changes = diffRecords(input.before ?? null, input.after ?? null);
          return {
            organisationId: input.organisationId,
            actorId: input.actorId ?? null,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            entityLabel: input.entityLabel?.slice(0, 300) ?? null,
            changes: changes.length > 0 ? (changes as unknown as object) : undefined,
            ipAddress: input.client?.ipAddress ?? null,
            userAgent: input.client?.userAgent ?? null,
          };
        }),
      });
    } catch (error) {
      this.logger.error('Failed to write bulk audit entries', error as Error);
    }
  }

  async query(organisationId: string, dto: AuditQueryDto): Promise<Paginated<AuditEntry>> {
    const where = {
      organisationId,
      ...(dto.entityType ? { entityType: dto.entityType } : {}),
      ...(dto.entityId ? { entityId: dto.entityId } : {}),
      ...(dto.actorId ? { actorId: dto.actorId } : {}),
      ...(dto.action ? { action: { contains: dto.action, mode: 'insensitive' as const } } : {}),
      ...(dto.from || dto.to
        ? {
            createdAt: {
              ...(dto.from ? { gte: new Date(`${dto.from}T00:00:00.000Z`) } : {}),
              ...(dto.to ? { lte: new Date(`${dto.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        entityLabel: row.entityLabel,
        actor: row.actor ? toUserSummary(row.actor) : null,
        changes: (row.changes as unknown as AuditChange[] | null) ?? [],
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      totalPages: Math.max(1, Math.ceil(total / dto.pageSize)),
    };
  }
}

/**
 * Field-level diff between two snapshots.
 *
 * Only changed keys are kept, so the log stays readable and small. Dates are
 * normalised to ISO strings first — otherwise two equal `Date` objects compare
 * as different and every update looks like it changed everything.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChange[] {
  if (!before && !after) return [];

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: AuditChange[] = [];

  for (const key of keys) {
    if (REDACTED_FIELDS.has(key)) continue;

    const from = normalise(before?.[key]);
    const to = normalise(after?.[key]);

    // A create has no `before`; record only the fields that carry a value so the
    // entry does not list thirty nulls.
    if (!before) {
      if (to !== null && to !== undefined && to !== '')
        changes.push({ field: key, before: null, after: to });
      continue;
    }
    if (!after) {
      if (from !== null && from !== undefined && from !== '')
        changes.push({ field: key, before: from, after: null });
      continue;
    }
    if (!deepEqual(from, to)) changes.push({ field: key, before: from, after: to });
  }

  return changes;
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object' && 'toNumber' in (value as object)) {
    // Prisma Decimal — compare as a plain number.
    return Number((value as { toNumber: () => number }).toNumber());
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
