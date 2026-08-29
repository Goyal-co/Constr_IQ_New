import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  bulkDesignSchema,
  createCommentSchema,
  closeRevisionSchema,
  createRevisionSchema,
  createWorkItemSchema,
  reorderSchema,
  updateWorkItemSchema,
  type BulkDesignDto,
  type CreateCommentDto,
  type CloseRevisionDto,
  type CreateRevisionDto,
  type CreateWorkItemDto,
  type ReorderDto,
  type UpdateWorkItemDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WorkItemsService } from './work-items.service';

/**
 * Work items are created and edited through one set of routes because they are
 * one row. The Design view sends `designComplete`; the Execution view sends
 * status and dates. Neither view has an endpoint the other lacks.
 */
@ApiTags('Work items')
@Controller('projects/:projectId/work-items')
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Post()
  @RequirePermissions('activity:create')
  @ApiOperation({
    summary: 'Add a work item to a phase — appears in both Design and Execution',
  })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(createWorkItemSchema)) dto: CreateWorkItemDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.workItems.create(actor, projectId, dto, client);
  }

  @Patch('bulk-design')
  @RequirePermissions('drawing:update')
  @ApiOperation({ summary: 'Mark the design track complete for a whole phase' })
  bulkDesign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(bulkDesignSchema)) dto: BulkDesignDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.workItems.setPhaseDesign(actor, projectId, dto, client);
  }

  @Patch('reorder')
  @RequirePermissions('activity:update')
  @ApiOperation({ summary: 'Reorder work items' })
  reorder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(reorderSchema)) dto: ReorderDto,
  ) {
    return this.workItems.reorder(actor, projectId, dto.ids);
  }

  @Post(':id/comments')
  @RequirePermissions('activity:update')
  @ApiOperation({ summary: 'Comment on an activity' })
  addComment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createCommentSchema)) dto: CreateCommentDto,
  ) {
    return this.workItems.addComment(actor, projectId, id, dto);
  }

  @Post(':id/revisions')
  @RequirePermissions('drawing:update')
  @ApiOperation({
    summary: 'Raise a revision — opens it, does not issue it',
  })
  openRevision(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createRevisionSchema)) dto: CreateRevisionDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.workItems.openRevision(actor, projectId, id, dto, client);
  }

  @Patch(':id/revisions/:revisionId/close')
  @RequirePermissions('drawing:update')
  @ApiOperation({
    summary: 'Close a revision out — the reissued drawing has landed',
  })
  closeRevision(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body(zodBody(closeRevisionSchema)) dto: CloseRevisionDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.workItems.closeRevision(actor, projectId, id, revisionId, dto, client);
  }

  @Patch(':id')
  @RequirePermissions('activity:update')
  @ApiOperation({ summary: 'Update the design track, the execution track, or both' })
  @ApiResponse({
    status: 409,
    description:
      'Returned when completing an item that still has undelivered materials linked to it. ' +
      'The response names them.',
  })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateWorkItemSchema)) dto: UpdateWorkItemDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.workItems.update(actor, projectId, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('activity:delete')
  @ApiOperation({ summary: 'Remove a work item. Linked materials are unlinked, not deleted.' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.workItems.remove(actor, projectId, id, client);
  }
}
