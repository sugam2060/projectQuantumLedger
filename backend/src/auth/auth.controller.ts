import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from './authenticated-user.interface';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { LogoutAllDto } from './dto/logout-all.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ClientTypeHeader, ClientTypePipe } from './pipes/client-type.pipe';
import type { ClientType } from './pipes/client-type.pipe';

const ACCESS_COOKIE_PATH = '/api/v1';
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async login(
    @Body() credentials: LoginDto,
    @ClientTypeHeader(ClientTypePipe) clientType: ClientType,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(credentials, { clientType });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');

    if (clientType === 'web') {
      this.setAuthCookies(response, result.accessToken, result.refreshToken);
      return this.responseWithoutTokens(result);
    }

    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async refresh(
    @Body() body: RefreshDto,
    @ClientTypeHeader(ClientTypePipe) clientType: ClientType,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken =
      clientType === 'web'
        ? readCookie(request, REFRESH_TOKEN_COOKIE)
        : body.refreshToken;
    if (!refreshToken) {
      throw new HttpException('Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }

    const result = await this.authService.refresh(refreshToken, { clientType });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');

    if (clientType === 'web') {
      this.setAuthCookies(response, result.accessToken, result.refreshToken);
      return this.responseWithoutTokens(result);
    }

    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(user.sessionId);
    this.clearAuthCookies(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @ClientTypeHeader(ClientTypePipe) clientType: ClientType,
    @Res({ passthrough: true }) response: Response,
    @Body() body?: LogoutAllDto,
  ): Promise<{ revoked: true }> {
    await this.authService.logoutAll(user.userId, body?.reason);

    if (clientType === 'web') {
      this.clearAuthCookies(response);
    }

    return { revoked: true };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@CurrentUser() user: AuthenticatedUser) {
    return {
      userId: user.userId,
      email: user.email,
    };
  }

  private clearAuthCookies(response: Response): void {
    response.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.shouldUseSecureCookies(),
      sameSite: 'strict',
      path: ACCESS_COOKIE_PATH,
    });
    response.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.shouldUseSecureCookies(),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  }

  private setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const secure = this.shouldUseSecureCookies();
    response.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: ACCESS_COOKIE_PATH,
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }

  private responseWithoutTokens(result: {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    user: { id: string; email: string };
    memberships: Array<{ businessId: string; branchIds: string[] }>;
  }) {
    return {
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
      user: result.user,
      memberships: result.memberships,
    };
  }

  private shouldUseSecureCookies(): boolean {
    const environment = this.configService.get<string>('NODE_ENV');
    return environment !== 'development' && environment !== 'test';
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.cookie;
  if (!cookies) {
    return undefined;
  }

  const cookie = cookies
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return cookie?.slice(name.length + 1);
}
