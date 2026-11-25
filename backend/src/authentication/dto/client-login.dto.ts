import { UserLoginDto } from './user-login.dto';

/**
 * Value of the X-Client-Type header. `web` is the account/platform website; the
 * others are retail terminals. Client type never grants anything: it only picks
 * how tokens are delivered and whether a terminal id is required.
 */
export enum ClientType {
  WEB = 'web',
  WEB_TERMINAL = 'web_terminal',
  DESKTOP = 'desktop',
  ANDROID_POS = 'android_pos',
  MOBILE = 'mobile',
}

/**
 * Browser clients keep the refresh token in an httpOnly cookie; native clients
 * receive it in the JSON body.
 */
export function isBrowserClient(clientType: ClientType | undefined): boolean {
  return (
    clientType === undefined ||
    clientType === ClientType.WEB ||
    clientType === ClientType.WEB_TERMINAL
  );
}

export class ClientLoginDto extends UserLoginDto {}
