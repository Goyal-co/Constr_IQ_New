import { Global, Module } from '@nestjs/common';
import { AppLogger } from './app-logger';

/**
 * Makes `AppLogger` injectable anywhere without every module importing it.
 *
 * Global because logging is genuinely cross-cutting: the alternative is adding
 * this to the imports of all seventeen feature modules, and the one that gets
 * forgotten is the one that falls back to an unstructured logger and quietly
 * stops correlating.
 *
 * `AppLogger` is transient-scoped, so each injecting class gets its own
 * instance and can set its own context.
 */
@Global()
@Module({ providers: [AppLogger], exports: [AppLogger] })
export class LoggingModule {}
