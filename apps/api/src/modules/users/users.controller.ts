import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignableRoles,
  inviteUserSchema,
  updateUserSchema,
  type InviteUserDto,
  type UpdateUserDto,
} from '@ciq/shared';
import {
  ClientInfo,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
  type ClientMeta,
} from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'Members of the organisation' })
  list(
    @CurrentUser('organisationId') organisationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.users.list(organisationId, includeInactive === 'true');
  }

  @Get('assignable-roles')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'Roles the caller is allowed to grant' })
  roles(@CurrentUser() actor: AuthenticatedUser) {
    return { roles: assignableRoles(actor.role) };
  }

  @Post('invite')
  @RequirePermissions('user:invite')
  @ApiOperation({ summary: 'Add a member and email them a temporary password' })
  invite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(inviteUserSchema)) dto: InviteUserDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.users.invite(actor, dto, client);
  }

  @Post(':id/reset-password')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: 'Issue a new temporary password and end their sessions' })
  resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.users.resetPassword(actor, id, client);
  }

  @Patch(':id')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: 'Rename a member, change their role, or reactivate them' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateUserSchema)) dto: UpdateUserDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.users.update(actor, id, dto, client);
  }

  @Delete(':id')
  @RequirePermissions('user:delete')
  @ApiOperation({ summary: 'Deactivate a member — the row is kept for the audit trail' })
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.users.deactivate(actor, id, client);
  }
}
