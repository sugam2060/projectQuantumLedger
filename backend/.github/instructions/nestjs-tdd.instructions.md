# NestJS TDD Instructions

Follow this Test-Driven Development approach for all NestJS features:

## Mandatory Workflow Order

1. **Service Unit Tests** (`*.service.spec.ts`)
   - Mock all dependencies
   - Cover success, edge, and error paths

2. **Controller Unit Tests** (`*.controller.spec.ts`)
   - Include guards, pipes, interceptors, middleware tests

3. **End-to-End Tests** (`test/*.e2e-spec.ts`)
   - Full request → response against real app module
   - Cover auth, validation failures, error cases

4. **Verify Test Failures**
   - Run tests and confirm they fail for right reasons

5. **Implementation**
   - Create DTOs, service, controller, supporting pieces
   - Continue until all tests pass

## Implementation Rules

- Never modify tests just to make them pass (flag if test is wrong)
- Business logic only in services
- API endpoints only in controllers
- DTO validation for all input
- Run `npm run test`, `npm run test:e2e`, type check, lint before finishing