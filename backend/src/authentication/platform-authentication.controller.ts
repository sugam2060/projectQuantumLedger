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
import {
  StrictThrottle,
  Throttle,
} from '../common/decorators/strict-throttle.decorator';
import type { Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { ClientType } from './dto/client-login.dto';
import { PlatformRefreshHeadersDto } from './dto/platform-refresh-headers.dto';
import { PlatformUserLoginDto } from './dto/platform-user-login.dto';
import { PlatformAuthenticationService } from './platform-authentication.service';
import type { PlatformAuthResult } from './platform-authentication.service';

@Controller('platform/user')
export class PlatformAuthenticationController {
  constructor(
    private readonly platformAuthService: PlatformAuthenticationService,
  ) {}

  @Post('login')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle({ limit: 20, ttlMs: 60_000 })
  async login(
    @Body() dto: PlatformUserLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headerClientType = request.headers['x-client-type'];
    if (
      Array.isArray(headerClientType) ||
      (headerClientType !== undefined &&
        !Object.values(ClientType).some(
          (clientType) => clientType === headerClientType,
        ))
    ) {
      throw new BadRequestException('A valid x-client-type header is required');
    }
    const clientType = headerClientType ?? dto.client_type;

    const result = await this.platformAuthService.login(dto, {
      method: request.method,
      endpointPath: request.route?.path,
      responseStatus: 200,
      requestId: request.header('x-request-id'),
      clientType: typeof clientType === 'string' ? clientType : undefined,
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    });
    if (clientType === ClientType.WEB || !clientType) {
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
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle({ limit: 60, ttlMs: 60_000 })
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

    const result = await this.platformAuthService.refresh(refreshToken, {
      method: request.method,
      endpointPath: request.route?.path,
      responseStatus: 200,
      requestId: request.header('x-request-id'),
      clientType: refreshHeaders.clientType,
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    });
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
