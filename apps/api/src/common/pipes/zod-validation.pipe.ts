import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Validates and coerces a request payload against a zod schema from `@ciq/shared`.
 *
 * The schema is the same object the web app uses for form validation, so a rule
 * cannot be enforced on one side and forgotten on the other. Failures return 422
 * with field-level messages keyed by dotted path, which the client maps straight
 * onto form fields.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'Validation Failed',
          message: 'The request could not be processed. Check the highlighted fields.',
          details: formatZodIssues(error),
        });
      }
      throw error;
    }
  }
}

/** Groups zod issues by dotted field path: `{ "handoverDate": ["Not a real date"] }`. */
export function formatZodIssues(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/** Convenience factory so controllers read `@Body(zodBody(createProjectSchema))`. */
export function zodBody<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/** Same pipe, named for query strings where coercion matters most. */
export function zodQuery<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
