import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration, { validateEnv } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './infra/mail/mail.module';
import { StorageModule } from './infra/storage/storage.module';

import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DesignFilesModule } from './modules/design-files/design-files.module';
import { ExportsModule } from './modules/exports/exports.module';
import { HealthModule } from './modules/health/health.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganisationModule } from './modules/organisation/organisation.module';
import { PhasesModule } from './modules/phases/phases.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { UsersModule } from './modules/users/users.module';
import { WorkItemsModule } from './modules/work-items/work-items.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      // Runs before anything else, so a missing or malformed variable fails the
      // boot with a readable message rather than surfacing as a runtime error.
      validate: validateEnv,
    }),

    /**
     * Per-IP rate limiting as a blunt outer layer. Auth routes tighten it further
     * with their own @Throttle decorators, and AuthService adds a per-account
     * lockout that an IP change cannot escape.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),

    ScheduleModule.forRoot(),

    PrismaModule,
    MailModule,
    StorageModule,

    // Global feature modules — audit, notifications, phases, templates and
    // settings are consumed by nearly every other module.
    AuditModule,
    NotificationsModule,
    OrganisationModule,
    PhasesModule,
    TemplatesModule,

    AuthModule,
    UsersModule,
    CategoriesModule,
    ProjectsModule,
    DesignFilesModule,
    WorkItemsModule,
    MaterialsModule,
    AttachmentsModule,
    ReportsModule,
    ExportsModule,
    SchedulerModule,
    HealthModule,
  ],
  providers: [
    // Order matters: authenticate, then rate-limit, then check permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
