import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createCommentSchema,
  createDesignFileSchema,
  closeRevisionSchema,
  createRevisionSchema,
  reorderSchema,
  updateDesignFileSchema,
  type CreateCommentDto,
  type CreateDesignFileDto,
  type CloseRevisionDto,
  type CreateRevisionDto,
  type ReorderDto,
  type UpdateDesignFileDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { DesignFilesService } from './design-files.service';

const bulkSchema = z.object({ isComplete: z.boolean() });

@ApiTags('Design')
@Controller('projects/:projectId/design-files')
export class DesignFilesController {
  constructor(private readonly designFiles: DesignFilesService) {}

  @Post()
  @RequirePermissions('drawing:create')
  @ApiOperation({ summary: 'Add a drawing or document to Design → Design Files' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(createDesignFileSchema)) dto: CreateDesignFileDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.designFiles.create(actor, projectId, dto, client);
  }

  @Patch('bulk')
  @RequirePermissions('drawing:update')
  @ApiOperation({ summary: 'Mark every design file issued, or reopen them all' })
  bulk(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(bulkSchema)) dto: { isComplete: boolean },
    @ClientInfo() client: ClientMeta,
  ) {
    return this.designFiles.setAll(actor, projectId, dto.isComplete, client);
  }

  @Patch('reorder')
  @RequirePermissions('drawing:update')
  @ApiOperation({ summary: 'Reorder design files' })
  reorder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(reorderSchema)) dto: ReorderDto,
  ) {
    return this.designFiles.reorder(actor, projectId, dto.ids);
  }

  @Post(':id/comments')
  @RequirePermissions('drawing:update')
  @ApiOperation({ summary: 'Comment on a drawing' })
  addComment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createCommentSchema)) dto: CreateCommentDto,
  ) {
    return this.designFiles.addComment(actor, projectId, id, dto);
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
    return this.designFiles.openRevision(actor, projectId, id, dto, client);
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
    return this.designFiles.closeRevision(actor, projectId, id, revisionId, dto, client);
  }

  @Patch(':id')
  @RequirePermissions('drawing:update')
  @ApiOperation({ summary: 'Rename a design file or change whether it is issued' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateDesignFileSchema)) dto: UpdateDesignFileDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.designFiles.update(actor, projectId, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('drawing:delete')
  @ApiOperation({ summary: 'Remove a design file' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.designFiles.remove(actor, projectId, id, client);
  }
}
