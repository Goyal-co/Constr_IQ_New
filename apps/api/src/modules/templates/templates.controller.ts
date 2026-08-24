import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  templateItemsSchema,
  templateSchema,
  type TemplateDto,
  type TemplateItemsDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { TemplatesService } from './templates.service';

@ApiTags('Configuration')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('project:read')
  @ApiOperation({ summary: 'Project playbooks available to this organisation' })
  list(@CurrentUser('organisationId') organisationId: string) {
    return this.templates.list(organisationId);
  }

  @Get(':id')
  @RequirePermissions('project:read')
  @ApiOperation({ summary: 'One template with its full item list' })
  findOne(
    @CurrentUser('organisationId') organisationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.findOne(organisationId, id);
  }

  @Post()
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Create a template' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(templateSchema)) dto: TemplateDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.templates.create(actor, dto, client);
  }

  @Post(':id/duplicate')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Copy a template and its items' })
  duplicate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.templates.duplicate(actor, id, client);
  }

  @Put(':id/items')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Replace a template item list in one atomic write' })
  setItems(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(templateItemsSchema)) dto: TemplateItemsDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.templates.setItems(actor, id, dto, client);
  }

  @Patch(':id')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Rename a template or make it the default' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(templateSchema.partial())) dto: Partial<TemplateDto>,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.templates.update(actor, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Delete a template' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.templates.remove(actor, id, client);
  }
}
