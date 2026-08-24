import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createProjectSchema,
  projectQuerySchema,
  reorderSchema,
  updateProjectSchema,
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
