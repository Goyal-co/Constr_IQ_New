import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AttachmentEntity, AttachmentKind } from '@prisma/client';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { AttachmentsService } from './attachments.service';

const ENTITY_TYPES: AttachmentEntity[] = ['PROJECT', 'DESIGN_FILE', 'MATERIAL', 'WORK_ITEM'];
const KINDS: AttachmentKind[] = ['DRAWING', 'PHOTO', 'PURCHASE_ORDER', 'DOCUMENT'];

@ApiTags('Attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @RequirePermissions('attachment:read')
  @ApiOperation({ summary: 'Files attached to an item, each with a signed download URL' })
  list(
    @CurrentUser('organisationId') organisationId: string,
    @Query('entityType') entityType: string,
    @Query('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return this.attachments.list(organisationId, assertEntityType(entityType), entityId);
  }

  @Post()
  @RequirePermissions('attachment:upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a drawing, photo, purchase order or document' })
  // Held in memory rather than a temp file: uploads are capped well below the
  // container memory budget, and this avoids leaving files on disk on a crash.
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('entityType') entityType: string,
    @Query('entityId', ParseUUIDPipe) entityId: string,
    @Query('kind') kind: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.attachments.upload(
      actor,
      {
        entityType: assertEntityType(entityType),
        entityId,
        kind: KINDS.includes(kind as AttachmentKind) ? (kind as AttachmentKind) : 'DOCUMENT',
        file,
      },
      client,
    );
  }

  @Delete(':id')
  @RequirePermissions('attachment:delete')
  @ApiOperation({ summary: 'Delete a file' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.attachments.remove(actor, id, client);
  }
}

function assertEntityType(value: string): AttachmentEntity {
  if (!ENTITY_TYPES.includes(value as AttachmentEntity)) {
    throw new Error(`entityType must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  return value as AttachmentEntity;
}
