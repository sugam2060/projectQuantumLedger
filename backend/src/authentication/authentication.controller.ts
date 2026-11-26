import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  StrictThrottle,
  Throttle,
} from '../common/decorators/strict-throttle.decorator';
import type { AuthenticatedUser } from '../common/types';
import { AuthCookieService } from './auth-cookie.service';
import { AuthenticationService } from './authentication.service';
import { AuthenticationLoginHeaders } from './decorators/authentication-login-headers.decorator';
import { ClientTypeHeaders } from './decorators/client-type-headers.decorator';
import { AuthenticationMeHeaders } from './decorators/authentication-me-headers.decorator';
import { OwnerRegistrationHeaders } from './decorators/owner-registration-headers.decorator';
import { AuthenticationLoginHeadersDto } from './dto/authentication-login-headers.dto';
import { AuthenticationLogoutHeadersDto } from './dto/authentication-logout-headers.dto';
import { AuthenticationMeHeadersDto } from './dto/authentication-me-headers.dto';
import { ClientLoginDto, isBrowserClient } from './dto/client-login.dto';
import { OwnerRegistrationDto } from './dto/owner-registration.dto';
import { OwnerRegistrationHeadersDto } from './dto/owner-registration-headers.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { PasswordResetService } from './password-reset.service';
import { OptionalClientTypeHeadersDto } from './dto/optional-client-type-headers.dto';
import { authMetadata, deliverTokens } from './utils/auth-response.util';

/** Business-user sign-in, token refresh, sign-out, /me and owner registration. */
@Controller('authentication')
export class AuthenticationController {
  constructor(
    private readonly authService: AuthenticationService,
    private readonly cookies: AuthCookieService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('register-owner')
  @StrictThrottle()
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @Throttle({ limit: 10, ttlMs: 60 * 60_000 })
  registerOwner(
    @Body() dto: OwnerRegistrationDto,
    @OwnerRegistrationHeaders() headers: OwnerRegistrationHeadersDto,
    @AuditContext() audit: AuditRequestContext,
  ) {
    return this.authService.registerOwner(dto, {
      ...audit,
      clientType: headers.clientType,
      responseStatus: 201,
    });
  }

  @Get('me')
  @Throttle({ limit: 60, ttlMs: 60_000 })
  getCurrentUser(
    @CurrentUser() user: AuthenticatedUser,
    @AuthenticationMeHeaders() headers: AuthenticationMeHeadersDto,
  ) {
    return this.authService.getCurrentUser(
      user,
      headers.clientType,
      headers.terminalId,
      headers.initialLoad,
    );
  }

  @Post('login')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Throttle({ limit: 100, ttlMs: 3_600_000 })
  @Public()
  async login(
    @Body() dto: ClientLoginDto,
    @AuthenticationLoginHeaders() headers: AuthenticationLoginHeadersDto,
    @AuditContext() audit: AuditRequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(
      dto,
      authMetadata(headers.clientType, headers.terminalId, audit),
    );
    return deliverTokens(
      result,
      headers.clientType,
      response,
      this.cookies,
      'user',
    );
  }

  @Post('refresh')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Public()
  async refresh(
    @Body() dto: RefreshTokenDto,
    @AuthenticationLoginHeaders() headers: AuthenticationLoginHeadersDto,
    @AuditContext() audit: AuditRequestContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const browser = isBrowserClient(headers.clientType);
    const token =
      dto.refreshToken ??
      (browser ? this.cookies.readRefreshCookie(request) : undefined);
    try {
      const result = await this.authService.refresh(
        token,
        authMetadata(headers.clientType, headers.terminalId, audit),
      );
      return deliverTokens(
        result,
        headers.clientType,
        response,
        this.cookies,
        'user',
      );
    } catch (error) {
      if (browser) this.cookies.clearRefreshCookie(response, 'user');
      throw error;
    }
  }

  /** Ends the current session. Always 204, even for an unknown token. */
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
    await this.authService.logout(
      dto.refreshToken ??
        (browser ? this.cookies.readRefreshCookie(request) : undefined),
    );
    if (browser) this.cookies.clearRefreshCookie(response, 'user');
  }

  /** Ends every session of the signed-in user (all devices). */
  @Post('logout-all')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logoutAll(user);
    this.cookies.clearRefreshCookie(response, 'user');
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
    const result = await this.authService.changePassword(
      user,
      dto,
      authMetadata(headers.clientType, undefined, audit),
    );
    return deliverTokens(
      result,
      headers.clientType,
      response,
      this.cookies,
      'user',
    );
  }

  /** Always 202: never reveals whether the email has an account. */
  @Post('forgot-password')
  @Public()
  @StrictThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.passwordReset.requestResetInBackground('user', dto.email);
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
    await this.passwordReset.reset('user', dto.token, dto.newPassword, audit);
  }
}
