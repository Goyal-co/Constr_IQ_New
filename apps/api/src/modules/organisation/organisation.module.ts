import { Global, Module } from '@nestjs/common';
import { OrganisationController } from './organisation.controller';
import { SettingsService } from './settings.service';

/** Global: nearly every metric calculation loads organisation settings. */
@Global()
@Module({
  controllers: [OrganisationController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class OrganisationModule {}
