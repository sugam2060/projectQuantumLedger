import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res as ResDecorator,
  Req as ReqDecorator,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserAuthService } from './authentication.service.user';
import type { ClientLoginDTO } from './dto/clientLogin.dto';
import { ClientType } from './dto/clientLogin.dto';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';

@Controller('authentication')
export class AuthenticationController {
  constructor(private readonly authService: UserAuthService) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    requests: 100,
    windowMs: 3600000, // 100 requests per hour
    // Dynamic adjustment based on system load
    dynamicAdjustment: true,
    loadThreshold: 0.8
  })
  async login(
    @Body() dto: ClientLoginDTO,
    @ReqDecorator() req: Request,
    @ResDecorator({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.userLogin(dto);

    // For web clients, set the JWT and refresh token as HTTP-only cookies
    if (dto.client_type === ClientType.WEB || !dto.client_type) {
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

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public()
  async refreshToken(
    @Body('refreshToken') refreshToken: string,
    @ReqDecorator() req: Request,
    @ResDecorator({ passthrough: true }) res: Response,
  ) {
    // For web clients, try to get refresh token from cookie if not in body
    const clientType = req.headers['x-client-type'];
    let token = refreshToken;

    if (clientType === 'web' && !token) {
      token = req.cookies?.refresh_token;
    }

    if (!token) {
      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      // Validate refresh token and generate new tokens
      const result = await this.authService.refreshAccessToken(token);

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
          const { accessToken, refreshToken: newRefreshToken, ...resultWithoutTokens } = result;
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
