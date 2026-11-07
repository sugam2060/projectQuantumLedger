# GitHub Copilot Instructions for Quantum Ledger

This document provides key development guidelines for GitHub Copilot when working on the Quantum Ledger project. For complete details, see [AGENTS.md](../AGENTS.md).

## Core Architecture Principles

1. **Separation of Concerns**:
   - Business logic belongs in `.service.ts` files
   - API endpoints belong in `.controller.ts` files
   - Data validation uses DTOs with `class-validator`

2. **NestJS Building Blocks**:
   - Use pipes for validation/transformation
   - Use guards for authentication/authorization
   - Use interceptors for cross-cutting concerns
   - Use middleware for request-level processing

3. **Dependency Injection**:
   - Always inject dependencies via constructors
   - Never instantiate services manually
   - Use ConfigModule for environment variables

## Development Workflow

Follow Test-Driven Development (TDD):
1. Write unit tests for services first
2. Write unit tests for controllers
3. Write e2e tests
4. Verify tests fail for the right reasons
5. Implement functionality until tests pass

## Technology Stack

- NestJS (v12.0.1) with TypeScript
- Drizzle ORM for PostgreSQL
- Redis for caching
- RabbitMQ for messaging
- NestJS Observe for observability

See AGENTS.md for full details on project structure, architecture rules, and development guidelines.