import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { notificationQuerySchema, type NotificationQueryDto } from '@ciq/shared';
import { CurrentUser } from '../../common/auth-context';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

/**
 * Notifications are personal, so every route is scoped to the caller's own id and
 * carries no permission requirement — there is nothing here another role needs to
 * be granted access to.
 */
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications, newest first' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(notificationQuerySchema)) query: NotificationQueryDto,
  ) {
    return this.notifications.list(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge count' })
  unreadCount(@CurrentUser('id') userId: string) {
    return this.notifications.unreadCount(userId);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification read' })
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss a notification' })
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.remove(userId, id);
  }
}
