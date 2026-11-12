import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';
import { ClientType } from './dto/clientLogin.dto';
import { PlatformRefreshHeadersDto } from './dto/platform-refresh-headers.dto';
import { PlatformUserLoginDto } from './dto/platform-user-login.dto';
import { PlatformAuthService } from './authentication.service.platform';
import type { PlatformAuthResult } from './authentication.service.platform';

@Controller('platform/user')
export class AuthenticationPlatformController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  @RateLimit({
    requests: 20,
    windowMs: 60_000,
    errorMessage: 'Too many platform login attempts. Try again shortly.',
  })
  async login(
    @Body() dto: PlatformUserLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.platformAuthService.login(dto);
    if (dto.client_type === ClientType.WEB || !dto.client_type) {
      const cookieOptions = {
        httpOnly: true,
        secure:
          request.secure || request.headers['x-forwarded-proto'] === 'https',
        maxAge: 15 * 60 * 1000,
        sameSite: 'strict' as const,
        path: '/',
      };
      response.cookie('access_token', result.accessToken, cookieOptions);
      response.cookie('refresh_token', result.refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return this.withoutTokens(result);
    }

    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public()
  @RateLimit({ requests: 60, windowMs: 60_000 })
  async refresh(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshHeaders = plainToInstance(PlatformRefreshHeadersDto, {
      refreshToken: headers['refresh-token'],
      clientType: headers['x-client-type'],
    });
    const validationErrors = await validate(refreshHeaders);
    if (validationErrors.length > 0) {
      throw new BadRequestException(
        'A refresh-token and valid x-client-type header are required',
      );
    }

    let refreshToken = refreshHeaders.refreshToken;
    if (refreshHeaders.clientType === ClientType.WEB && !refreshToken) {
      refreshToken = request.cookies?.refresh_token;
    }
    if (!refreshToken) {
      throw new UnauthorizedException('A refresh token is required');
    }

    const result = await this.platformAuthService.refresh(refreshToken);
    if (refreshHeaders.clientType === ClientType.WEB) {
      const cookieOptions = {
        httpOnly: true,
        secure:
          request.secure || request.headers['x-forwarded-proto'] === 'https',
        maxAge: 15 * 60 * 1000,
        sameSite: 'strict' as const,
        path: '/',
      };
      response.cookie('access_token', result.accessToken, cookieOptions);
      response.cookie('refresh_token', result.refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return this.withoutTokens(result);
    }

    return result;
  }

  private withoutTokens(
    result: PlatformAuthResult,
  ): Omit<PlatformAuthResult, 'accessToken' | 'refreshToken'> {
    return {
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
      user: result.user,
      isPlatform: result.isPlatform,
      isBootstrap: result.isBootstrap,
    };
  }
}
