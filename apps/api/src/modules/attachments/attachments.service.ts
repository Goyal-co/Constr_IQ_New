import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AttachmentEntity, AttachmentKind } from '@prisma/client';
import type { Attachment } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { toUserSummary } from '../users/user.mapper';

/**
 * File types accepted for upload.
 *
 * An allow-list rather than a block-list: the set of things a site team needs to
 * attach is small and known, while the set of things that should never be served
 * back to a browser is open-ended. SVG is deliberately absent — it is a script
 * container that renders inline.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/msword',
  'text/csv',
  'text/plain',
  'application/acad',
  'image/vnd.dwg',
  'application/dxf',
  'image/vnd.dxf',
  'application/zip',
]);

/** Magic-number prefixes for the formats where a signature check is worthwhile. */
const MAGIC_NUMBERS: { mime: string; bytes: number[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
];

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async list(
    organisationId: string,
    entityType: AttachmentEntity,
    entityId: string,
  ): Promise<Attachment[]> {
    const rows = await this.prisma.attachment.findMany({
      where: { organisationId, entityType, entityId },
      include: { uploadedBy: true },
      orderBy: { createdAt: 'desc' },
    });

    // Signed URLs are minted per response and expire, so a link copied out of the
    // page stops working rather than becoming a permanent public handle.
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        kind: row.kind,
        entityType: row.entityType,
        entityId: row.entityId,
        uploadedBy: toUserSummary(row.uploadedBy),
        uploadedAt: row.createdAt.toISOString(),
        downloadUrl: await this.storage.signedUrl(row.storageKey),
      })),
    );
  }

  async upload(
    actor: AuthenticatedUser,
    params: {
      entityType: AttachmentEntity;
      entityId: string;
      kind: AttachmentKind;
      file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
    },
    client?: ClientMeta,
  ): Promise<Attachment> {
    const { file } = params;
    const maxBytes = this.config.get('storage', { infer: true }).maxUploadBytes;

    if (!file?.buffer?.length) throw new BadRequestException('No file was received.');
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(
        `Files must be ${Math.round(maxBytes / 1024 / 1024)}MB or smaller.`,
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`${file.mimetype} files are not accepted.`);
    }
    this.assertContentMatchesType(file.mimetype, file.buffer);

    await this.assertEntityBelongsToTenant(
      actor.organisationId,
      params.entityType,
      params.entityId,
    );

    const key = this.storage.buildKey(
      actor.organisationId,
      params.entityType,
      params.entityId,
      file.originalname,
    );
    const stored = await this.storage.put(key, file.buffer, file.mimetype);

    const attachment = await this.prisma.attachment.create({
      data: {
        organisationId: actor.organisationId,
        entityType: params.entityType,
        entityId: params.entityId,
        kind: params.kind,
        fileName: file.originalname.slice(-400),
        storageKey: stored.storageKey,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        uploadedById: actor.id,
      },
      include: { uploadedBy: true },
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'attachment.uploaded',
      entityType: params.entityType,
      entityId: params.entityId,
      entityLabel: attachment.fileName,
      after: {
        fileName: attachment.fileName,
        sizeBytes: attachment.sizeBytes,
        kind: attachment.kind,
      },
      client,
    });

    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      kind: attachment.kind,
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      uploadedBy: toUserSummary(attachment.uploadedBy),
      uploadedAt: attachment.createdAt.toISOString(),
      downloadUrl: await this.storage.signedUrl(attachment.storageKey),
    };
  }

  async remove(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!attachment) throw new NotFoundException('That file does not exist.');

    // Row first, then object: a deleted row with a stranded object is a tidy-up
    // job, whereas a live row pointing at a missing object is a broken download.
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.delete(attachment.storageKey);

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'attachment.deleted',
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      entityLabel: attachment.fileName,
      before: { fileName: attachment.fileName, sizeBytes: attachment.sizeBytes },
      client,
    });

    return { success: true };
  }

  /**
   * Confirms the target row exists inside the caller's tenant.
   *
   * Without this, an attacker could attach a file to another organisation's
   * drawing id — the upload itself would succeed and the file would surface on
   * their screen.
   */
  private async assertEntityBelongsToTenant(
    organisationId: string,
    entityType: AttachmentEntity,
    entityId: string,
  ): Promise<void> {
    const exists = await (async () => {
      switch (entityType) {
        case 'PROJECT':
          return this.prisma.project.findFirst({
            where: { id: entityId, organisationId, deletedAt: null },
            select: { id: true },
          });
        case 'DESIGN_FILE':
          return this.prisma.designFile.findFirst({
            where: { id: entityId, project: { organisationId, deletedAt: null } },
            select: { id: true },
          });
        case 'MATERIAL':
          return this.prisma.material.findFirst({
            where: { id: entityId, project: { organisationId, deletedAt: null } },
            select: { id: true },
          });
        case 'WORK_ITEM':
          return this.prisma.workItem.findFirst({
            where: { id: entityId, project: { organisationId, deletedAt: null } },
            select: { id: true },
          });
      }
    })();

    if (!exists) throw new NotFoundException('That item does not exist, or you cannot see it.');
  }

  /**
   * Cross-checks the declared MIME type against the file's leading bytes.
   *
   * The browser-supplied content type is a claim, not evidence. Types without a
   * stable signature (CAD, plain text) are allowed through on the declared type
   * alone, which is why the allow-list matters more than this check.
   */
  private assertContentMatchesType(mimeType: string, buffer: Buffer): void {
    const expected = MAGIC_NUMBERS.find((m) => m.mime === mimeType);
    if (!expected) return;

    const matches = expected.bytes.every((byte, index) => buffer[index] === byte);
    if (!matches) {
      throw new BadRequestException(
        `That file does not look like a ${mimeType.split('/')[1].toUpperCase()} despite its extension.`,
      );
    }
  }
}
