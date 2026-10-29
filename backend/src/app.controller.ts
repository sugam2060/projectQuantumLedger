import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('onboarding')
  @HttpCode(HttpStatus.ACCEPTED)
  receiveOnboarding(@Body() payload: unknown) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Onboarding payload must be a JSON object.');
    }
    console.log('Received onboarding payload:', payload);
    return {
      acknowledged: true,
      message: 'Onboarding data received.',
    };
  }
}
