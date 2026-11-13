import { UserLoginDTO } from './userLogin.dto';

export enum ClientType {
  WEB = 'web',
  MOBILE = 'mobile',
  DESKTOP = 'desktop',
}

export class ClientLoginDTO extends UserLoginDTO {}
