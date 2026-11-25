import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY, Public } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types';

type ParamFactory = (data: unknown, context: ExecutionContext) => unknown;

/** Extracts the factory Nest stores for a custom param decorator. */
function getParamFactory(decorator: ParameterDecorator): ParamFactory {
  class Probe {
    handler(_value: unknown): void {}
  }
  decorator(Probe.prototype, 'handler', 0);
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<string, { factory: ParamFactory }>;
  return Object.values(metadata)[0].factory;
}

const contextWithUser = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('common decorators', () => {
  it('@Public() sets the IS_PUBLIC_KEY metadata', () => {
    class Controller {
      @Public()
      route(): void {}
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Controller.prototype.route)).toBe(
      true,
    );
  });

  it('@CurrentUser() returns request.user', () => {
    const user: AuthenticatedUser = {
      subjectId: 'u1',
      userId: 'u1',
      permissions: [],
    };
    const factory = getParamFactory(CurrentUser());
    expect(factory(undefined, contextWithUser(user))).toBe(user);
  });

  it('@CurrentUser() returns undefined when nobody is signed in', () => {
    const factory = getParamFactory(CurrentUser());
    expect(factory(undefined, contextWithUser())).toBeUndefined();
  });
});
