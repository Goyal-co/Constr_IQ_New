import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyTemplateSchema,
  createProjectSchema,
  projectQuerySchema,
  reorderSchema,
  updateProjectSchema,
  type ApplyTemplateDto,
  type CreateProjectDto,
  type ProjectQueryDto,
  type ReorderDto,
  type UpdateProjectDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('project:read')
  @ApiOperation({ summary: 'List projects with filters, sorting and pagination' })
  list(
    @CurrentUser('organisationId') organisationId: string,
    @Query(zodQuery(projectQuerySchema)) query: ProjectQueryDto,
  ) {
    return this.projects.list(organisationId, query);
  }

  @Get(':id')
  @RequirePermissions('project:read')
  @ApiOperation({ summary: 'One project with its drawings, materials and activities' })
  findOne(
    @CurrentUser('organisationId') organisationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projects.findOne(organisationId, id);
  }

  @Post()
  @RequirePermissions('project:create')
  @ApiOperation({ summary: 'Create a project, optionally seeded from the standard playbook' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(createProjectSchema)) dto: CreateProjectDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projects.create(actor, dto, client);
  }

  @Patch('reorder')
  @RequirePermissions('project:reorder')
  @ApiOperation({ summary: 'Rewrite manual ordering from an id sequence' })
  reorder(@CurrentUser() actor: AuthenticatedUser, @Body(zodBody(reorderSchema)) dto: ReorderDto) {
    return this.projects.reorder(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions('project:update')
  @ApiOperation({ summary: 'Update project details' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateProjectSchema)) dto: UpdateProjectDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projects.update(actor, id, dto, client);
  }

  /**
   * Apply a template to a project that already exists.
   *
   * `project:update` rather than `project:create`: this changes a project
   * somebody already has, and the people allowed to edit one are the people who
   * should be allowed to add scope to it.
   *
   * The service appends — existing drawings, activities and materials are left
   * untouched — so this is the recovery path for a project created without a
   * template, and equally for adding a second template's worth of scope later.
   */
  @Post(':id/apply-template')
  // 200, not Nest's default 201: nothing is created at a new URL. This mutates
  // a project that already exists and returns it, which is the same shape as
  // the auth and scheduler POSTs that also override the status.
  @HttpCode(200)
  @RequirePermissions('project:update')
  @ApiOperation({ summary: 'Seed an existing project from a template, appending to its lists' })
  applyTemplate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(applyTemplateSchema)) dto: ApplyTemplateDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projects.applyTemplate(actor, id, dto, client);
  }

  @Post(':id/restore')
  @RequirePermissions('project:delete')
  @ApiOperation({ summary: 'Restore a soft-deleted project' })
  restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projects.restore(actor, id, client);
  }

  @Delete(':id')
  @RequirePermissions('project:delete')
  @ApiOperation({ summary: 'Soft-delete a project' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.projects.remove(actor, id, client);
  }
}
