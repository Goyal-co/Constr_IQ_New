import { Injectable, Logger } from '@nestjs/common';
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
 * Attachment storage, on the local filesystem.
 *
 * This used to carry a second S3-compatible driver alongside this one. It was
 * removed because nothing reached it: the web client has no upload control at
 * all — no `<input type="file">`, no multipart request, and the `useAttachments`
 * hook is defined and imported by nothing — so the API's attachment routes are
 * unreachable from the application, and the bucket they would have written to
 * stayed empty. Keeping it meant an S3 account, five environment variables, a
 * MinIO container in the development stack and a 9MB SDK, all to serve a code
 * path no user could trigger.
 *
 * **Before building an upload UI, put the S3 driver back.** A container
 * filesystem does not survive a redeploy and is not shared between replicas, so
 * this driver loses every file the first time the service restarts. That is
 * harmless while nothing is stored and unacceptable the moment something is.
 * The removed implementation is in git history — see the commit that deleted
 * `@aws-sdk/client-s3` from apps/api/package.json.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get settings() {
    return this.config.get('storage', { infer: true });
  }

  /**
   * Builds the object key.
   *
   * Tenant id leads so a future bucket policy can restrict by prefix, and a
   * random uuid separates the stored name from the user-supplied one — two
   * people uploading `plan.pdf` must not collide, and a crafted filename must
   * not escape the prefix.
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
   * The directory has to exist and be writable by the user the process runs as.
   * In a container that is `node`, not root, and a directory left owned by root
   * is the usual way this fails — silently, on the first upload, long after
   * deployment.
   *
   * Never throws. A health check that can throw turns a degraded dependency
   * into a 500 on the endpoint whose job is to report degraded dependencies.
   */
  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
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
    this.logger.debug(`Storing ${key} (${(body.byteLength / 1024).toFixed(0)}kB, ${mimeType})`);

    const target = this.localPath(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(async function* () {
      yield body;
    }, createWriteStream(target));

    this.logger.log({
      message: `Stored ${key}`,
      sizeBytes: body.byteLength,
      durationMs: Date.now() - started,
    });
    return { storageKey: key, sizeBytes: body.byteLength, checksum };
  }

  /**
   * Where a client should fetch the file.
   *
   * **`GET /attachments/local/:key` is not implemented.** That is a pre-existing
   * gap, not a consequence of dropping the S3 driver: nothing serves this path
   * today, so a download would 404. It has never mattered because nothing can
   * upload either — but it is the second thing to build, right after the upload
   * control, and it must set `Content-Disposition` from the stored `fileName`
   * or every file saves under its uuid storage key.
   *
   * With S3 this returned a short-lived pre-signed URL, so a 40MB drawing was
   * fetched straight from the bucket rather than occupying an API worker for
   * the length of the transfer. That consideration returns with the driver.
   */
  signedUrl(key: string): string {
    return `/attachments/local/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.localPath(key));
      this.logger.debug(`Deleted ${key}`);
    } catch (error) {
      // A missing object is the desired end state, so treat it as success.
      this.logger.warn(`Could not delete object ${key}: ${(error as Error).message}`);
    }
  }

  /** Reads a stored file back for the download route. */
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
