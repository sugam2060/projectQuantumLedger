import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  RequestSession,
  RequestContextService,
} from './request_context.service';

interface AuthenticatedRequest {
  user?: RequestSession;
}

@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  constructor(private readonly contextService: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.user ?? {};

    return new Observable((subscriber) =>
      this.contextService.run(session, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
