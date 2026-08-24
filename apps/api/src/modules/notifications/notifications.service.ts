import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Notification, NotificationKind, NotificationQueryDto, Paginated } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface PushInput {
  organisationId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  projectId?: string | null;
  /**
   * Stable key for recurring alerts. The nightly sweep raises the same warning
   * every run; without a dedupe key a manager returns from leave to two hundred
   * copies of the same message and stops reading the panel entirely.
   */
  dedupeKey?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create one in-app notification.
   *
   * Never throws: a notification is a courtesy attached to a business action that
   * has already succeeded, so a failure here must not fail the request.
   */
  async push(input: PushInput): Promise<void> {
    try {
      const data = {
        organisationId: input.organisationId,
        userId: input.userId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        projectId: input.projectId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      };

      if (input.dedupeKey) {
        // Refresh the existing alert rather than stacking a duplicate.
        await this.prisma.notification.upsert({
          where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
          create: data,
          update: { title: data.title, body: data.body, isRead: false, createdAt: new Date() },
        });
        return;
      }

      await this.prisma.notification.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      this.logger.error(`Failed to push ${input.kind} to user ${input.userId}`, error as Error);
    }
  }

  /** Fan one alert out to several people in a single insert. */
  async pushMany(inputs: PushInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await this.prisma.notification.createMany({
        data: inputs.map((i) => ({
          organisationId: i.organisationId,
          userId: i.userId,
          kind: i.kind,
          title: i.title.slice(0, 200),
          body: i.body.slice(0, 1000),
          projectId: i.projectId ?? null,
          dedupeKey: i.dedupeKey ?? null,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.error('Failed to push notification batch', error as Error);
    }
  }

  async list(userId: string, query: NotificationQueryDto): Promise<Paginated<Notification>> {
    const where = { userId, ...(query.unreadOnly ? { isRead: false } : {}) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        include: { project: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind as NotificationKind,
        title: row.title,
        body: row.body,
        projectId: row.projectId,
        projectName: row.project?.name ?? null,
        isRead: row.isRead,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.notification.count({ where: { userId, isRead: false } }) };
  }

  /** Scoped by userId as well as id so one user cannot mark another's alerts read. */
  async markRead(userId: string, id: string): Promise<{ success: true }> {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    return { success: true };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: count };
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
    return { success: true };
  }

  /** Housekeeping: drop read notifications older than 90 days. */
  async purgeOld(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    const { count } = await this.prisma.notification.deleteMany({
      where: { isRead: true, createdAt: { lt: cutoff } },
    });
    return count;
  }
}
