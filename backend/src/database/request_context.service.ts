import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestSession {
  businessId?: string;
  userId?: string;
  branchId?: string;
  platformUserId?: string;
  isPlatform?: boolean;
  isOwner?: boolean; // <-- Added here
}

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestSession>();

  run<T>(session: RequestSession, callback: () => T): T {
    return this.als.run(session, callback);
  }

  getSession(): RequestSession {
    return this.als.getStore() ?? {};
  }
}
