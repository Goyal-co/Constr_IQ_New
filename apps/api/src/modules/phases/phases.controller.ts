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
  phaseSchema,
  reorderSchema,
  updatePhaseSchema,
  type PhaseDto,
  type ReorderDto,
  type UpdatePhaseDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PhasesService } from './phases.service';

@ApiTags('Configuration')
@Controller('phases')
export class PhasesController {
  constructor(private readonly phases: PhasesService) {}

  @Get()
  @RequirePermissions('project:read')
  @ApiOperation({ summary: 'Delivery phases in configured order' })
  list(
    @CurrentUser('organisationId') organisationId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.phases.list(organisationId, includeArchived === 'true');
  }

  @Post()
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Create a delivery phase' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(phaseSchema)) dto: PhaseDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.phases.create(actor, dto, client);
  }

  @Patch('reorder')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Reorder phases' })
  reorder(@CurrentUser() actor: AuthenticatedUser, @Body(zodBody(reorderSchema)) dto: ReorderDto) {
    return this.phases.reorder(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Rename, recolour or archive a phase' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updatePhaseSchema)) dto: UpdatePhaseDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.phases.update(actor, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Delete an unused phase' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.phases.remove(actor, id, client);
  }
}
