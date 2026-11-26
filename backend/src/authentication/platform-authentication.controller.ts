import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  StrictThrottle,
  Throttle,
} from '../common/decorators/strict-throttle.decorator';
import type { AuthenticatedUser } from '../common/types';
import { AuthCookieService } from './auth-cookie.service';
import { ClientTypeHeaders } from './decorators/client-type-headers.decorator';
import { AuthenticationLogoutHeadersDto } from './dto/authentication-logout-headers.dto';
import { isBrowserClient } from './dto/client-login.dto';
import { OptionalClientTypeHeadersDto } from './dto/optional-client-type-headers.dto';
import { PlatformUserLoginDto } from './dto/platform-user-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { PasswordResetService } from './password-reset.service';

import { PlatformAuthenticationService } from './platform-authentication.service';
import { authMetadata, deliverTokens } from './utils/auth-response.util';

/** Fortis-staff sign-in, refresh and sign-out. */
@Controller('platform/user')
@PlatformRoute()
export class PlatformAuthenticationController {
  constructor(
    private readonly platformAuthService: PlatformAuthenticationService,
    private readonly cookies: AuthCookieService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('login')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle({ limit: 20, ttlMs: 60_000 })
  async login(
    @Body() dto: PlatformUserLoginDto,
    @ClientTypeHeaders() headers: OptionalClientTypeHeadersDto,
    @AuditContext() audit: AuditRequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    // The header wins over the body field; both are optional (default: web).
    const clientType = headers.clientType ?? dto.client_type;
    const result = await this.platformAuthService.login(
      dto,
      authMetadata(clientType, undefined, audit),
    );
    return deliverTokens(
      result,
      clientType,
      response,
      this.cookies,
      'platform',
    );
  }

  @Post('refresh')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle({ limit: 60, ttlMs: 60_000 })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @ClientTypeHeaders() headers: AuthenticationLogoutHeadersDto,
    @Headers('refresh-token') legacyHeaderToken: string | undefined,
    @AuditContext() audit: AuditRequestContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const browser = isBrowserClient(headers.clientType);
    // `refresh-token` header: deprecated, still accepted for older clients.
    const token =
      dto.refreshToken ??
      legacyHeaderToken ??
      (browser ? this.cookies.readRefreshCookie(request) : undefined);
    try {
      const result = await this.platformAuthService.refresh(
        token,
        authMetadata(headers.clientType, undefined, audit),
      );
      return deliverTokens(
        result,
        headers.clientType,
        response,
        this.cookies,
        'platform',
      );
    } catch (error) {
      if (browser) this.cookies.clearRefreshCookie(response, 'platform');
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshTokenDto,
    @ClientTypeHeaders() headers: AuthenticationLogoutHeadersDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const browser = isBrowserClient(headers.clientType);
    await this.platformAuthService.logout(
      dto.refreshToken ??
        (browser ? this.cookies.readRefreshCookie(request) : undefined),
    );
    if (browser) this.cookies.clearRefreshCookie(response, 'platform');
  }

  @Post('logout-all')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platformAuthService.logoutAll(user);
    this.cookies.clearRefreshCookie(response, 'platform');
    return result;
  }

  /** Changes the password, signs out every device, returns a new session. */
  @Post('change-password')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @ClientTypeHeaders() headers: OptionalClientTypeHeadersDto,
    @AuditContext() audit: AuditRequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platformAuthService.changePassword(
      user,
      dto,
      authMetadata(headers.clientType, undefined, audit),
    );
    return deliverTokens(
      result,
      headers.clientType,
      response,
      this.cookies,
      'platform',
    );
  }

  /** Always 202: never reveals whether the email has an account. */
  @Post('forgot-password')
  @Public()
  @StrictThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.passwordReset.requestResetInBackground('platform', dto.email);
    return {
      message:
        'If an account exists for this email, a reset link has been sent.',
    };
  }

  /** Sets a new password from an emailed link; signs out every device. */
  @Post('reset-password')
  @Public()
  @StrictThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @AuditContext() audit: AuditRequestContext,
  ): Promise<void> {
    await this.passwordReset.reset(
      'platform',
      dto.token,
      dto.newPassword,
      audit,
    );
  }
}
