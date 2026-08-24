import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  organisationSettingsSchema,
  updateOrganisationSchema,
  type OrganisationSettingsDto,
  type UpdateOrganisationDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';

@ApiTags('Configuration')
@Controller('organisation')
export class OrganisationController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('org:read')
  @ApiOperation({ summary: 'Organisation profile' })
  get(@CurrentUser('organisationId') organisationId: string) {
    return this.settings.getOrganisation(organisationId);
  }

  @Get('settings')
  @RequirePermissions('org:read')
  @ApiOperation({ summary: 'Every tunable threshold, window and weight' })
  getSettings(@CurrentUser('organisationId') organisationId: string) {
    return this.settings.get(organisationId);
  }

  @Patch('settings')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Update thresholds, weights, locale and digest schedule' })
  updateSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(organisationSettingsSchema)) dto: OrganisationSettingsDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.settings.update(actor, dto, client);
  }

  @Patch()
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Rename the organisation or change its logo' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(updateOrganisationSchema)) dto: UpdateOrganisationDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.settings.updateOrganisation(actor, dto, client);
  }
}
