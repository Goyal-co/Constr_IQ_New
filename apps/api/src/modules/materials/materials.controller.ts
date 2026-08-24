import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMaterialSchema,
  updateMaterialSchema,
  type CreateMaterialDto,
  type UpdateMaterialDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { MaterialsService } from './materials.service';

@ApiTags('Materials')
@Controller('projects/:projectId/materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get('schedule')
  @RequirePermissions('material:read')
  @ApiOperation({ summary: 'Buying list for this project, soonest order-by date first' })
  schedule(
    @CurrentUser('organisationId') organisationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.materials.schedule(organisationId, projectId);
  }

  @Get('suggest-date')
  @RequirePermissions('material:read')
  @ApiOperation({ summary: 'Suggest an order-by date from a lead time and the handover date' })
  suggestDate(
    @CurrentUser('organisationId') organisationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('leadTimeWeeks', ParseIntPipe) leadTimeWeeks: number,
  ) {
    return this.materials.suggestDate(organisationId, projectId, leadTimeWeeks);
  }

  @Get('blocking/:workItemId')
  @RequirePermissions('material:read')
  @ApiOperation({ summary: 'Materials currently stopping a work item from completing' })
  blocking(
    @CurrentUser('organisationId') organisationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
  ) {
    return this.materials.blockingFor(organisationId, projectId, workItemId);
  }

  @Post()
  @RequirePermissions('material:create')
  @ApiOperation({
    summary: 'Add a material with its order-by date, phase tag and optional work-item link',
  })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(createMaterialSchema)) dto: CreateMaterialDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.materials.create(actor, projectId, dto, client);
  }

  @Patch(':id')
  @RequirePermissions('material:update')
  @ApiOperation({ summary: 'Update a material, its dates, its tag, its link or its status' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateMaterialSchema)) dto: UpdateMaterialDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.materials.update(actor, projectId, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('material:delete')
  @ApiOperation({ summary: 'Remove a material' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.materials.remove(actor, projectId, id, client);
  }
}
