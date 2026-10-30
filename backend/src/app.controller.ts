import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/health/live')
  @HttpCode(HttpStatus.OK)
  live() {
    return {
      statusCode: HttpStatus.OK,
      body: {
        status: 'ok',
        version: this.configService.get<string>('version', '1.0.0'),
      },
    };
  }

  @Get('/health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.appService.getReadiness();

    response.status(
      result.isReady
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return result.body;
  }
}
