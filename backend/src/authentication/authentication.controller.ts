import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Res as ResDecorator,
  Req as ReqDecorator,
  UnauthorizedException,
} from '@nestjs/common';
import {
  StrictThrottle,
  Throttle,
} from '../common/decorators/strict-throttle.decorator';
import type { Request, Response } from 'express';
import { AuthenticationService } from './authentication.service';
import { ClientLoginDto, ClientType } from './dto/client-login.dto';
import { Public } from '../common/decorators/public.decorator';
import { RequiredRoles } from './decorators/required_permission.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { AuthenticationMeHeadersDto } from './dto/authentication-me-headers.dto';
import { AuthenticationMeHeaders } from './decorators/authentication-me-headers.decorator';
import { AuthenticationLoginHeaders } from './decorators/authentication-login-headers.decorator';
import { AuthenticationLoginHeadersDto } from './dto/authentication-login-headers.dto';
import { OwnerRegistrationDto } from './dto/owner-registration.dto';
import { OwnerRegistrationHeadersDto } from './dto/owner-registration-headers.dto';
import { OwnerRegistrationHeaders } from './decorators/owner-registration-headers.decorator';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('authentication')
export class AuthenticationController {
  constructor(private readonly authService: AuthenticationService) {}

  @Post('register-owner')
  @StrictThrottle()
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @Throttle({ limit: 10, ttlMs: 60 * 60_000 })
  registerOwner(
    @Body() dto: OwnerRegistrationDto,
    @OwnerRegistrationHeaders() headers: OwnerRegistrationHeadersDto,
    @ReqDecorator() request: Request,
  ) {
    return this.authService.registerOwner(dto, {
      method: 'POST',
      endpointPath: request.route?.path,
      responseStatus: 201,
      requestId: request.header('x-request-id'),
      clientType: headers.clientType,
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Get('me')
  @Throttle({ limit: 60, ttlMs: 60_000 })
  getCurrentUser(
    @ReqDecorator() request: AuthenticatedRequest,
    @AuthenticationMeHeaders()
    headers: AuthenticationMeHeadersDto,
  ) {
    return this.authService.getCurrentUser(
      request.user,
      headers.clientType,
      headers.terminalId,
      headers.initialLoad,
    );
  }

  @Post('login')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Throttle({ limit: 100, ttlMs: 3600000 })
  @Public()
  @RequiredRoles('users.login')
  async login(
    @Body() dto: ClientLoginDto,
    @AuthenticationLoginHeaders()
    headers: AuthenticationLoginHeadersDto,
    @ReqDecorator() req: Request,
    @ResDecorator({ passthrough: true }) res: Response,
  ) {
    const clientType = headers.clientType ?? ClientType.WEB;
    const result = await this.authService.userLogin(dto, headers.terminalId, {
      method: req.method,
      endpointPath: req.route?.path,
      responseStatus: 200,
      requestId: req.header('x-request-id'),
      clientType,
      terminalId: headers.terminalId,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
    });
    // For web clients, set the JWT and refresh token as HTTP-only cookies
    if (clientType === ClientType.WEB) {
      const cookieOptions = {
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        maxAge: dto.remember ? 7 * 24 * 60 * 60 * 1000 : 15 * 60 * 1000, // 7 days or 15 minutes
        sameSite: 'strict' as const,
        path: '/',
      };

      // Set access token cookie
      res.cookie('access_token', result.accessToken, cookieOptions);

      // Set refresh token cookie if provided and remember is true
      if (result.refreshToken && dto.remember) {
        const refreshTokenOptions = {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for refresh token
        };
        res.cookie('refresh_token', result.refreshToken, refreshTokenOptions);
      }

      // Return the result without the tokens for web clients since they're in cookies
      const { accessToken, refreshToken, ...resultWithoutTokens } = result;
      return resultWithoutTokens;
    }

    // For mobile and desktop clients, return the JWT in the response body
    return result;
  }

  @RequiredRoles('users.refresh')
  @Post('refresh')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @Public()
  async refreshToken(
    @Body('refreshToken') refreshToken: string | undefined,
    @AuthenticationLoginHeaders() headers: AuthenticationLoginHeadersDto,
    @ReqDecorator() req: Request,
    @ResDecorator({ passthrough: true }) res: Response,
  ) {
    // For web clients, try to get refresh token from cookie if not in body
    const clientType = headers.clientType ?? ClientType.WEB;
    let token = refreshToken;

    if (clientType === 'web' && !token) {
      token = req.cookies?.refresh_token;
    }

    if (!token) {
      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      // Validate refresh token and generate new tokens
      const result = await this.authService.refreshAccessToken(
        token,
        headers.terminalId,
        {
          method: req.method,
          endpointPath: req.route?.path,
          responseStatus: 200,
          requestId: req.header('x-request-id'),
          clientType,
          terminalId: headers.terminalId,
          ipAddress: req.ip,
          userAgent: req.header('user-agent'),
        },
      );

      // For web clients, set new tokens as cookies
      if (clientType === 'web') {
        const cookieOptions = {
          httpOnly: true,
          secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
          maxAge: 15 * 60 * 1000, // 15 minutes for access token
          sameSite: 'strict' as const,
          path: '/',
        };

        res.cookie('access_token', result.accessToken, cookieOptions);

        // If new refresh token is generated, set it as cookie too
        if (result.refreshToken) {
          const refreshTokenOptions = {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for refresh token
          };
          res.cookie('refresh_token', result.refreshToken, refreshTokenOptions);

          // Return result without tokens for web clients
          const {
            accessToken,
            refreshToken: newRefreshToken,
            ...resultWithoutTokens
          } = result;
          return resultWithoutTokens;
        } else {
          // Return result without access token for web clients
          const { accessToken, ...resultWithoutAccessToken } = result;
          return resultWithoutAccessToken;
        }
      }

      // For mobile/desktop clients, return tokens in response body
      return result;
    } catch (error) {
      // Remove refresh token from Redis on invalid token
      await this.authService.invalidateRefreshToken(token);
      throw error;
    }
  }
}
