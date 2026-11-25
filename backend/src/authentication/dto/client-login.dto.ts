import { UserLoginDto } from './user-login.dto';

export enum ClientType {
  WEB = 'web',
  MOBILE = 'mobile',
  DESKTOP = 'desktop',
}

export class ClientLoginDto extends UserLoginDto {}
