@AGENTS.md

# Fortis POS - Claude Code Configuration

This document outlines the configuration and skills available for the Fortis POS backend project when using Claude Code.

## Available Skills

### Drizzle ORM Skill
- **Location**: `.claude/skills/drizzle/`
- **Description**: Type-safe SQL ORM for TypeScript with zero runtime overhead
- **Usage**: Load the skill with: `/skill drizzle`

### Passport Authentication Skill
- **Description**: NestJS authentication with Passport strategies (JWT, Local, OAuth)
- **Key Patterns**: 
  - Extend `PassportStrategy(Strategy)` for custom strategies
  - Implement `validate()` methods for credential verification
  - Use `AuthGuard` with custom guard classes instead of magic strings
  - Secure password storage with bcrypt hashing
- **Usage**: Reference AGENTS.md for implementation guidelines

## Parallel Execution Guidance

When working on tasks with Claude Code, always follow this systematic approach:

### Break Down Complex Problems
1. **Decompose the problem** into smaller, manageable subtasks
2. **Identify dependencies** between subtasks
3. **Prioritize independent tasks** that can be executed in parallel
4. **Sequence dependent tasks** in the correct order

### Parallel Execution with Multiple Agents
1. **Spawn dedicated agents** for each independent subtask
2. **Assign specific responsibilities** to each agent
3. **Use parallel execution** to reduce overall completion time
4. **Coordinate results** from multiple agents for final integration

Example workflow:
```
Complex Task: Implement user authentication with database storage
├── Subtask 1: Design database schema (assign to DB agent)
├── Subtask 2: Create authentication service logic (assign to Auth agent)
├── Subtask 3: Implement security measures (assign to Security agent)
└── Subtask 4: Create API endpoints (assign to API agent)
```

For Passport authentication implementation:
```
Authentication Feature: JWT + Local strategies
├── Subtask 1: Create User entity and database schema
├── Subtask 2: Implement AuthService with credential validation
├── Subtask 3: Create LocalStrategy and JwtStrategy classes
├── Subtask 4: Implement AuthController with login endpoint
├── Subtask 5: Create AuthGuard classes and @Public decorator
└── Subtask 6: Protect application routes with authentication
```

This approach ensures efficient resource utilization and faster development cycles.

## NestJS Observe Integration

This application integrates with NestJS Observe for production monitoring:
- Real-time tracing and error tracking
- Performance metrics and log aggregation
- Release comparison and regression detection
- Direct integration with the Observe MCP server

To link with Observe:
```bash
npx @nestjs/observe link
```