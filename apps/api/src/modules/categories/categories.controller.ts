import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { categorySchema, reorderSchema, type CategoryDto, type ReorderDto } from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CategoriesService } from './categories.service';

@ApiTags('Configuration')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('project:read')
  @ApiOperation({ summary: 'Project categories with live project counts' })
  list(@CurrentUser('organisationId') organisationId: string) {
    return this.categories.list(organisationId);
  }

  @Post()
  @RequirePermissions('category:create')
  @ApiOperation({ summary: 'Create a category' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(categorySchema)) dto: CategoryDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.categories.create(actor, dto, client);
  }

  @Patch('reorder')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Reorder categories' })
  reorder(@CurrentUser() actor: AuthenticatedUser, @Body(zodBody(reorderSchema)) dto: ReorderDto) {
    return this.categories.reorder(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Rename a category' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(categorySchema.partial())) dto: Partial<CategoryDto>,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.categories.update(actor, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Delete an empty category' })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.categories.remove(actor, id, client);
  }
}
