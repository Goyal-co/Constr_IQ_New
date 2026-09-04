import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from '../../config/configuration';

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Object storage for attachments.
 *
 * Two drivers behind one interface: S3-compatible (MinIO locally, AWS S3 or
 * Cloudflare R2 in production) and a local filesystem fallback for environments
 * with no object store at all. Files are never streamed through the API on
 * download — clients get a short-lived signed URL, so a 40MB drawing does not
 * occupy an API worker for the length of the transfer.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get settings() {
    return this.config.get('storage', { infer: true });
  }

  onModuleInit(): void {
    if (this.settings.driver !== 's3') {
      this.logger.warn(
        'Using the local filesystem for attachments. Suitable for development only — ' +
          'container filesystems are ephemeral and are not shared between replicas.',
      );
      return;
    }
    this.client = new S3Client({
      region: this.settings.region,
      endpoint: this.settings.endpoint,
      forcePathStyle: this.settings.forcePathStyle,
      credentials: {
        accessKeyId: this.settings.accessKeyId!,
        secretAccessKey: this.settings.secretAccessKey!,
      },
    });
  }

  /**
   * Builds the object key.
   *
   * Tenant id leads so a bucket policy can restrict by prefix, and a random uuid
   * separates the stored name from the user-supplied one — two people uploading
   * `plan.pdf` must not collide, and a crafted filename must not escape the
   * prefix.
   */
  buildKey(organisationId: string, entityType: string, entityId: string, fileName: string): string {
    const safeName = fileName
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(-120);
    return `${organisationId}/${entityType.toLowerCase()}/${entityId}/${randomUUID()}-${safeName}`;
  }

  /**
   * Can attachments actually be written? Surfaced through `/health/ready`.
   *
   * Checks reachability, not correctness of a single object: `HeadBucket` proves
   * the endpoint resolves, the credentials are accepted and the bucket exists —
   * the three things that are wrong when attachments fail on a fresh
   * deployment. It writes nothing, so a probe every thirty seconds does not
   * accumulate objects somebody has to clean up.
   *
   * Never throws. A health check that can throw turns a degraded dependency
   * into a 500 on the endpoint whose job is to report degraded dependencies.
   */
  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
      if (this.settings.driver === 's3') {
        if (!this.client) return { ok: false, detail: 'the S3 client was never initialised' };
        await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
        return { ok: true };
      }

      // Local driver: the directory has to exist and be writable by the user
      // the process runs as. In a container that is `node`, not root, and a
      // directory left owned by root is the usual way this fails — silently,
      // on the first upload, long after deployment.
      const dir = resolve(this.settings.localDir);
      await mkdir(dir, { recursive: true });
      await access(dir, fsConstants.W_OK);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<StoredObject> {
    const checksum = createHash('sha256').update(body).digest('hex');
    const started = Date.now();
    this.logger.debug(
      `Storing ${key} (${(body.byteLength / 1024).toFixed(0)}kB, ${mimeType}) via ${this.settings.driver}`,
    );

    if (this.settings.driver === 's3' && this.client) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          Body: body,
          ContentType: mimeType,
          // Content-Disposition is set on the signed GET, not here, so the same
          // object can be previewed inline or forced as a download.
          Metadata: { checksum },
        }),
      );
      this.logger.log({
        message: `Stored ${key}`,
        driver: 's3',
        sizeBytes: body.byteLength,
        durationMs: Date.now() - started,
      });
      return { storageKey: key, sizeBytes: body.byteLength, checksum };
    }

    const target = this.localPath(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(async function* () {
      yield body;
    }, createWriteStream(target));
    this.logger.log({
      message: `Stored ${key}`,
      driver: 'local',
      sizeBytes: body.byteLength,
      durationMs: Date.now() - started,
    });
    return { storageKey: key, sizeBytes: body.byteLength, checksum };
  }

  /** Time-limited URL. Expiry comes from config so it can be tightened per environment. */
  async signedUrl(key: string, fileName?: string): Promise<string> {
    this.logger.verbose(`Signing a ${this.settings.signedUrlTtlSeconds}s URL for ${key}`);
    if (this.settings.driver === 's3' && this.client) {
      return getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          ...(fileName
            ? { ResponseContentDisposition: `attachment; filename="${sanitiseHeader(fileName)}"` }
            : {}),
        }),
        { expiresIn: this.settings.signedUrlTtlSeconds },
      );
    }
    // Local driver: served by the API's own download route instead.
    return `/attachments/local/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.settings.driver === 's3' && this.client) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
        return;
      }
      await unlink(this.localPath(key));
      this.logger.debug(`Deleted ${key}`);
    } catch (error) {
      // A missing object is the desired end state, so treat it as success.
      this.logger.warn(`Could not delete object ${key}: ${(error as Error).message}`);
    }
  }

  /** Only used by the local driver's download route. */
  createLocalReadStream(key: string) {
    return createReadStream(this.localPath(key));
  }

  /**
   * Resolves a key beneath the upload directory, refusing anything that escapes
   * it. Keys are generated server-side, but path traversal is cheap to prevent
   * and expensive to discover later.
   */
  private localPath(key: string): string {
    const root = resolve(this.settings.localDir);
    const target = resolve(join(root, key));
    if (!target.startsWith(root))
      throw new Error('Refusing to resolve a path outside the upload root');
    return target;
  }
}

function sanitiseHeader(value: string): string {
  return value.replace(/["\r\n]/g, '');
}
