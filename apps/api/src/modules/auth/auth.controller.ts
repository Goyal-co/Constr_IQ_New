import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  type ChangePasswordDto,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
} from '@ciq/shared';
import { ClientInfo, CurrentUser, Public, type ClientMeta } from '../../common/auth-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('setup-state')
  @ApiOperation({ summary: 'Whether this deployment still needs its first organisation' })
  setupState() {
    return this.auth.needsSetup();
  }

  @Public()
  @Post('register')
  // Registration is one-shot per deployment, so a tight limit costs nothing.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Create the organisation and its first owner' })
  register(@Body(zodBody(registerSchema)) dto: RegisterDto, @ClientInfo() client: ClientMeta) {
    return this.auth.register(dto, client);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  // Per-IP brake in front of the per-account lockout in AuthService.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange credentials for an access and refresh token' })
  login(@Body(zodBody(loginSchema)) dto: LoginDto, @ClientInfo() client: ClientMeta) {
    return this.auth.login(dto, client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate a refresh token for a fresh token pair' })
  refresh(@Body(zodBody(refreshSchema)) dto: RefreshDto, @ClientInfo() client: ClientMeta) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  logout(@Body(zodBody(refreshSchema)) dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their organisation and permissions' })
  me(@CurrentUser('id') userId: string) {
    return this.auth.me(userId);
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Change your password and sign out other devices' })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body(zodBody(changePasswordSchema)) dto: ChangePasswordDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.auth.changePassword(userId, dto, client);
  }
}
