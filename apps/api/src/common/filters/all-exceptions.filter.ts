import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Single exit point for every error leaving the API.
 *
 * Two jobs: give the client a stable error envelope it can rely on, and make sure
 * an unexpected failure never leaks a stack trace, a SQL fragment or a column
 * name to the browser. Full detail goes to the log with the request id attached.
 *
 * It does not write the access line — `LoggingInterceptor` logs every request
 * with its status and duration, this one included. What is logged here is the
 * part the interceptor cannot see: the exception itself, and its stack.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // `id` is attached by the request-id middleware, which Express's own types
    // know nothing about. Narrowing to the one property actually read is more
    // honest than casting the whole request to `any`.
    const requestId = (request as Request & { id?: string }).id ?? undefined;

    const { status, body } = this.normalise(exception);

    const where = `${request.method} ${request.originalUrl}`;

    if (status >= 500) {
      // Ours. The stack is the whole point of the line.
      this.logger.error(
        `${where} failed: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status !== 404) {
      /**
       * Theirs — a validation failure, a permission refusal, a gate.
       *
       * Logged at `debug`, not `warn`: the interceptor already records a 4xx as
       * a warning with the status and the path, so repeating it here would
       * double every rejected request in the log. What this adds is the
       * *reason*, which the interceptor has no access to — and that is worth
       * having available without being on by default.
       */
      this.logger.debug(`${where} rejected with ${status}: ${body.message}`);
    }

    response.status(status).json({ ...body, requestId });
  }

  private normalise(exception: unknown): {
    status: number;
    body: { statusCode: number; message: string; error?: string; details?: unknown };
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { status, body: { statusCode: status, message: payload } };
      }
      const record = payload as Record<string, unknown>;
      return {
        status,
        body: {
          statusCode: status,
          message: Array.isArray(record.message)
            ? (record.message as string[]).join(', ')
            : String(record.message ?? exception.message),
          error: record.error as string | undefined,
          details: record.details,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // Almost always a bug in our own query construction, not user input.
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          statusCode: 400,
          message: 'The request could not be processed.',
          error: 'Bad Request',
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: 500,
        message: 'Something went wrong on our side. The incident has been logged.',
        error: 'Internal Server Error',
      },
    };
  }

  /** Translates the Prisma error codes we can act on into meaningful HTTP status. */
  private fromPrisma(error: Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | undefined)?.filter(
          (t) => t !== 'organisationId',
        );
        const field = target?.join(', ') ?? 'value';
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: 409,
            error: 'Conflict',
            message: `A record with this ${field} already exists.`,
            details: target ? { [target[0] ?? 'field']: ['Already in use'] } : undefined,
          },
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { statusCode: 404, error: 'Not Found', message: 'That record no longer exists.' },
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: 409,
            error: 'Conflict',
            message: 'That record is still referenced by something else and cannot be removed.',
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'A database error occurred.',
          },
        };
    }
  }
}
