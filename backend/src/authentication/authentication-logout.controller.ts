import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PlatformAuthenticationService } from './platform-authentication.service';
import { AuthenticationService } from './authentication.service';
import { AuthenticationLogoutHeaders } from './decorators/authentication-logout-headers.decorator';
import { AuthenticationLogoutDto } from './dto/authentication-logout.dto';
import { AuthenticationLogoutHeadersDto } from './dto/authentication-logout-headers.dto';
import { ClientType } from './dto/client-login.dto';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

interface AuthenticatedLogoutRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('authentication')
export class AuthenticationLogoutController {
  constructor(
    private readonly userAuthService: AuthenticationService,
    private readonly platformAuthService: PlatformAuthenticationService,
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: AuthenticatedLogoutRequest,
    @AuthenticationLogoutHeaders()
    headers: AuthenticationLogoutHeadersDto,
    @Body() dto: AuthenticationLogoutDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken =
      dto?.refreshToken ??
      (headers.clientType === ClientType.WEB
        ? request.cookies?.refresh_token
        : undefined);

    if (refreshToken) {
      const sessionId = request.user.isPlatform
        ? request.user.platformUserId
        : request.user.userId;
      if (!sessionId) {
        throw new UnauthorizedException('Authenticated session is invalid');
      }

      if (request.user.isPlatform) {
        await this.platformAuthService.invalidateRefreshTokenForSession(
          refreshToken,
          sessionId,
        );
      } else {
        await this.userAuthService.invalidateRefreshTokenForSession(
          refreshToken,
          sessionId,
        );
      }
    }

    if (headers.clientType === ClientType.WEB) {
      const cookieOptions = { path: '/', sameSite: 'strict' as const };
      response.clearCookie('access_token', cookieOptions);
      response.clearCookie('refresh_token', cookieOptions);
    }

    return { revoked: true };
  }
}
