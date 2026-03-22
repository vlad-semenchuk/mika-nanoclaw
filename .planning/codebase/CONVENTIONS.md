# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- kebab-case: `src/container-runner.ts`, `src/task-scheduler.ts`, `src/group-queue.ts`, `src/credential-proxy.ts`
- Test files: `{name}.test.ts` co-located with implementation (e.g., `src/db.ts` with `src/db.test.ts`)
- Skills-engine tests: `skills-engine/__tests__/{name}.test.ts` (separate `__tests__` directory)

**Functions:**
- camelCase: `runContainerAgent()`, `computeNextRun()`, `getMessagesSince()`, `storeMessage()`
- Helper functions prefixed with underscore when internal/private: `_initTestDatabase()`
- Handler functions: `processIpcFiles()`, `runTask()`, `handleMessage()`

**Variables:**
- camelCase for local variables and parameters: `groupJid`, `newSessionId`, `containerName`, `lastTimestamp`
- UPPER_SNAKE_CASE for constants (exported): `MAX_CONCURRENT_CONTAINERS`, `CONTAINER_TIMEOUT`, `POLL_INTERVAL`
- Trailing "Id" suffix for identifiers: `taskId`, `sessionId`, `chatJid`, `messageId`
- State object fields use snake_case matching database schema: `group_folder`, `schedule_type`, `is_from_me`, `is_bot_message`

**Types:**
- PascalCase: `ContainerInput`, `ContainerOutput`, `RegisteredGroup`, `ScheduledTask`, `NewMessage`
- Interface names: `export interface {Name}` (e.g., `QueuedTask`, `GroupState`, `ProxyConfig`)
- Type aliases: `export type AuthMode = 'api-key' | 'oauth'`
- Discriminated unions with `status` field: `status: 'success' | 'error'` in `ContainerOutput`

## Code Style

**Formatting:**
- Prettier with `singleQuote: true` configuration (see `.prettierrc`)
- Single quotes throughout: `'./config.js'`, `'group-queue'`
- No semicolons at end of JSDoc comments

**Linting:**
- ESLint with TypeScript support (`@eslint/js`, `typescript-eslint`)
- Plugin: `eslint-plugin-no-catch-all` enforces specific error handling (no bare `catch`)
- Run with: `npm run lint` or `npm run lint:fix`

**File Organization:**
- Imports grouped in three sections (separated by blank lines):
  1. Node.js builtins: `import fs from 'fs'`, `import path from 'path'`, `import { ChildProcess } from 'child_process'`
  2. External packages: `import { CronExpressionParser } from 'cron-parser'`, `import pino from 'pino'`
  3. Local modules: `import { ASSISTANT_NAME } from './config.js'`, `import { logger } from './logger.js'`
- All local imports use `.js` extension (required for ESM): `from './db.js'`, `from './types.js'`

**Example import pattern from `src/ipc.ts`:**
```typescript
import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, IPC_POLL_INTERVAL, TIMEZONE } from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';
```

## Error Handling

**Pattern:**
- Use try-catch for synchronous operations and async errors
- Distinguish between error types: `instanceof Error ? err.message : String(err)`
- Never use bare `catch` blocks (enforced by linter)—always name the error variable

**Example from `src/task-scheduler.ts`:**
```typescript
try {
  groupDir = resolveGroupFolderPath(task.group_folder);
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  updateTask(task.id, { status: 'paused' });
  logger.error(
    { taskId: task.id, groupFolder: task.group_folder, error },
    'Task has invalid group folder',
  );
}
```

**Example from `src/group-queue.ts`:**
```typescript
try {
  // File operation
} catch (err) {
  logger.error({ groupJid, err }, 'Unhandled error in runForGroup');
}
```

**Patterns for specific scenarios:**
- When catching and not throwing, log the error and use a fallback value
- When catching input parsing errors, validate types before use
- Use specific error message strings for logging context

## Logging

**Framework:** Pino (`pino` + `pino-pretty` for development)

**Setup:** (`src/logger.ts`)
```typescript
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});
```

**Usage patterns:**
- `logger.debug({ context }, 'message')` for detailed tracing (won't print unless LOG_LEVEL=debug)
- `logger.info({ context }, 'message')` for normal operations
- `logger.warn({ context }, 'message')` for recoverable issues
- `logger.error({ err }, 'message')` for caught errors
- `logger.fatal({ err }, 'message')` for fatal errors (triggers process.exit(1))

**Example from `src/group-queue.ts`:**
```typescript
logger.debug({ groupJid }, 'Container active, message queued');
logger.debug(
  { groupJid, activeCount: this.activeCount },
  'At concurrency limit, message queued',
);
```

**Global error handlers (`src/logger.ts`):**
```typescript
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
```

## Comments

**When to Comment:**
- Block comments explain architectural decisions, security implications, or non-obvious logic
- Security-critical blocks are marked with intent: `// Security: ...`, `// Shadow .env so the agent cannot read secrets`
- Guard clauses documented if behavior is critical: `// Guard against malformed interval that would cause an infinite loop`
- Comments on backwards compatibility: `// Re-export for backwards compatibility during refactor`

**Example from `src/container-runner.ts`:**
```typescript
// Main gets the project root read-only. Writable paths the agent needs
// (group folder, IPC, .claude/) are mounted separately below.
// Read-only prevents the agent from modifying host application code
// (src/, dist/, package.json, etc.) which would bypass the sandbox
// entirely on next restart.
mounts.push({
  hostPath: projectRoot,
  containerPath: '/workspace/project',
  readonly: true,
});

// Shadow .env so the agent cannot read secrets from the mounted project root.
// Credentials are injected by the credential proxy, never exposed to containers.
const envFile = path.join(projectRoot, '.env');
if (fs.existsSync(envFile)) {
  mounts.push({
    hostPath: '/dev/null',
    containerPath: '/workspace/project/.env',
    readonly: true,
  });
}
```

**JSDoc/TSDoc:**
- Used sparingly—primary for exported functions and interfaces
- Document purpose, parameters, and return values
- Example from `src/task-scheduler.ts`:
```typescript
/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
```

## Function Design

**Size:**
- Functions are small and focused; typical size 20-80 lines
- Complex operations broken into helper functions

**Parameters:**
- Use explicit parameters, avoid long parameter lists
- For dependency injection, use objects: `deps: SchedulerDependencies` containing `{ registeredGroups, getSessions, queue, onProcess, sendMessage }`
- Overrides passed as object: `overrides: { id: string, chat_jid: string, ... }`

**Return Values:**
- Functions return concrete types: `Promise<void>`, `string | null`, `RegisteredGroup | undefined`
- Status responses use discriminated unions:
```typescript
export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}
```

**Example from `src/group-queue.ts`:**
```typescript
private getGroup(groupJid: string): GroupState {
  let state = this.groups.get(groupJid);
  if (!state) {
    state = { /* initialization */ };
    this.groups.set(groupJid, state);
  }
  return state;
}

setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
  this.processMessagesFn = fn;
}
```

## Module Design

**Exports:**
- Export named functions and types, not default exports
- Common patterns:
  - `export function functionName() { }`
  - `export interface InterfaceName { }`
  - `export type TypeName = ...`
  - `export class ClassName { }`

**Barrel Files:**
- Not commonly used; modules import directly from specific files
- Example: `import { logger } from './logger.js'` not from an index

**Class Design:**
- Classes used for stateful objects with multiple methods
- Example: `export class GroupQueue` in `src/group-queue.ts`
- Private fields use `private` modifier: `private groups = new Map<...>()`
- Private methods use `private` modifier: `private getGroup(groupJid: string): GroupState`

**Example class from `src/group-queue.ts`:**
```typescript
export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null = null;
  private shuttingDown = false;

  private getGroup(groupJid: string): GroupState { }
  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void { }
  enqueueMessageCheck(groupJid: string): void { }
}
```

## TypeScript Configuration

**Key Settings (`tsconfig.json`):**
- Target: `ES2022`
- Module system: `NodeNext` (supports ESM)
- Strict mode: enabled
- Declaration files generated: `true`
- Source maps generated: `true`

**Compilation:**
- Run with: `npm run build` (compiles to `dist/`)
- Check types only: `npm run typecheck`
- Service runs compiled JS from `dist/` — always rebuild after code changes

---

*Convention analysis: 2026-03-22*
