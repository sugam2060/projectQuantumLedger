import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { StrictThrottle } from '../common/decorators/strict-throttle.decorator';
import { AcceptInvitationDto, InvitationTokenQueryDto } from './dto';
import { MyInvitationsService } from './my-invitations.service';

/** Public invitation links: preview and accept with the emailed token. */
@Controller('invitations')
@Public()
export class MyInvitationsController {
  constructor(private readonly invitations: MyInvitationsService) {}

  @Get('preview')
  @StrictThrottle()
  preview(@Query() query: InvitationTokenQueryDto) {
    return this.invitations.preview(query.token);
  }

  @Post('accept')
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  accept(@Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(dto);
  }
}
