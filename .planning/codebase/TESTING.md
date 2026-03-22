# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts` (main tests), `vitest.skills.config.ts` (skills-engine tests)
- Language: TypeScript

**Assertion Library:**
- Vitest built-in assertions (expect API)

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Watch mode with hot reload
npm run test -- --coverage  # Generate coverage report
```

**Coverage Setup:**
- Package: `@vitest/coverage-v8`
- Output location: not configured (defaults to `./coverage`)
- Coverage gaps identified in tests with `.toHaveLength(0)` or `.toBeUndefined()` patterns

## Test File Organization

**Location:**
- **Co-located pattern (main src/):** Tests sit next to implementation: `src/db.ts` paired with `src/db.test.ts`
  - Files: `src/container-runner.test.ts`, `src/db.test.ts`, `src/group-queue.test.ts`, `src/task-scheduler.test.ts`, `src/credential-proxy.test.ts`, `src/group-folder.test.ts`, `src/container-runtime.test.ts`, `src/routing.test.ts`, `src/formatting.test.ts`, `src/ipc-auth.test.ts`, `src/channels/telegram.test.ts`
- **Separate directory (skills-engine):** `skills-engine/__tests__/` contains all tests
  - Files: `skills-engine/__tests__/state.test.ts`, `skills-engine/__tests__/apply.test.ts`, etc.
  - Helper file: `skills-engine/__tests__/test-helpers.ts` (shared setup utilities)

**Naming:**
- `{module-name}.test.ts` (e.g., `db.test.ts`, `group-queue.test.ts`)
- Consistency: all tests use `.test.ts` extension (not `.spec.ts`)

**Structure:**
```
src/
├── db.ts
├── db.test.ts
├── container-runner.ts
├── container-runner.test.ts
└── [other modules...]

skills-engine/
├── __tests__/
│   ├── state.test.ts
│   ├── apply.test.ts
│   ├── test-helpers.ts
│   └── [other test files...]
├── state.ts
├── apply.ts
└── [other implementation files...]
```

## Test Structure

**Suite Organization:**

From `src/db.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  getMessagesSince,
  storeMessage,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to reduce boilerplate
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

// Test suite with descriptive names
describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
  });

  it('filters out empty content', () => {
    // ... test body
  });

  it('upserts on duplicate id+chat_jid', () => {
    // ... test body
  });
});
```

**Patterns:**

1. **Setup with helpers:** Create reusable helper functions (e.g., `store()`, `createTempDir()`)
2. **Descriptive test names:** Use `it('behavior being tested', () => { })`
3. **Arrange-Act-Assert:** Organize tests into clear sections (comments optional but pattern follows)
4. **Grouped assertions:** Multiple assertions in a test when testing related functionality

From `src/group-queue.test.ts`:
```typescript
beforeEach(() => {
  vi.useFakeTimers();
  queue = new GroupQueue();
});

afterEach(() => {
  vi.useRealTimers();
});
```

## Mocking

**Framework:** Vitest's built-in `vi` module

**Module Mocking Pattern:**
```typescript
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000,
  TIMEZONE: 'America/Los_Angeles',
  CONTAINER_ENV_FORWARD: ['GROQ_API_KEY', 'OPENAI_API_KEY'],
}));
```

**Function Mocking:**
```typescript
const mockReadEnvFile = vi.fn(() => ({}));
vi.mock('./env.js', () => ({
  readEnvFile: (...args: any[]) => mockReadEnvFile(...args),
}));
```

**Partial fs Module Mock (from `src/container-runner.test.ts`):**
```typescript
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
    },
  };
});
```

**Logger Mock:**
```typescript
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
```

**Fake Process Creation (from `src/container-runner.test.ts`):**
```typescript
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
    exec: vi.fn((_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
      if (cb) cb(null);
      return new EventEmitter();
    }),
  };
});
```

**What to Mock:**
- External services (APIs, file system operations) to isolate the code under test
- Dependencies (config, logger, child processes) that have side effects
- Time (using `vi.useFakeTimers()` / `vi.useRealTimers()`) for scheduler tests

**What NOT to Mock:**
- Core business logic that the test is trying to verify
- Database operations when testing SQL/persistence (instead, use `_initTestDatabase()`)
- Type constructors and interfaces

## Fixtures and Factories

**Test Data Helpers:**

From `src/db.test.ts`:
```typescript
// Helper function reduces boilerplate and provides default values
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}
```

**Factory Functions (from `skills-engine/__tests__/test-helpers.ts`):**
```typescript
export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-test-'));
}

export function setupNanoclawDir(tmpDir: string): void {
  fs.mkdirSync(path.join(tmpDir, '.nanoclaw', 'base', 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.nanoclaw', 'backup'), { recursive: true });
}

export function createSkillPackage(tmpDir: string, opts: {
  skill?: string;
  version?: string;
  core_version?: string;
  adds?: string[];
  modifies?: string[];
  addFiles?: Record<string, string>;
  modifyFiles?: Record<string, string>;
  // ... more options
}): string {
  const skillDir = path.join(tmpDir, opts.dirName ?? 'skill-pkg');
  fs.mkdirSync(skillDir, { recursive: true });
  // ... setup logic
  return skillDir;
}
```

**Cleanup Pattern:**
```typescript
export function cleanup(tmpDir: string): void {
  // Remove temporary directory after test
}
```

**Usage Pattern (from `skills-engine/__tests__/apply.test.ts`):**
```typescript
beforeEach(() => {
  tmpDir = createTempDir();
  setupNanoclawDir(tmpDir);
  createMinimalState(tmpDir);
  initGitRepo(tmpDir);
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  cleanup(tmpDir);
});
```

**Location:**
- `skills-engine/__tests__/test-helpers.ts` for shared utilities
- Inline helpers within test files when specific to a single test module

## Test Types

**Unit Tests:**
- Focus: Individual functions and methods in isolation
- Scope: Single module with dependencies mocked
- Examples: `db.test.ts` tests database operations, `group-queue.test.ts` tests queue logic
- Pattern: Mock external dependencies, test pure behavior

**Integration Tests:**
- Focus: Multiple modules working together
- Scope: Less mocking; test actual data flow (e.g., `apply.test.ts` tests skill application with real file operations)
- Pattern: Use test helpers to set up realistic state, verify end-to-end behavior

**E2E Tests:**
- Status: Not implemented (out of scope for this codebase)
- Would test: Full agent container execution end-to-end

## Async Testing

**Pattern from `src/group-queue.test.ts`:**
```typescript
it('only runs one container per group at a time', async () => {
  let concurrentCount = 0;
  let maxConcurrent = 0;

  const processMessages = vi.fn(async (_groupJid: string) => {
    concurrentCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrentCount);
    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 100));
    concurrentCount--;
    return true;
  });

  queue.setProcessMessagesFn(processMessages);
  queue.enqueueMessageCheck('group1@g.us');
  queue.enqueueMessageCheck('group1@g.us');

  // Advance timers to let the first process complete
  await vi.advanceTimersByTimeAsync(200);

  // Assertion after async work
  expect(maxConcurrent).toBe(1);
});
```

**Timer Management:**
- `vi.useFakeTimers()` in `beforeEach()` for controllable time
- `vi.useRealTimers()` in `afterEach()` to restore real timers
- `await vi.advanceTimersByTimeAsync(ms)` to fast-forward and wait for promises

**Promise Handling:**
- Tests marked `async` when they use `await`
- No explicit `.then()` chains; use async/await throughout
- Vitest automatically detects promise rejections and reports them

## Error Testing

**Pattern from `skills-engine/__tests__/apply.test.ts`:**
```typescript
it('rejects when min_skills_system_version is too high', async () => {
  const skillDir = createSkillPackage(tmpDir, {
    skill: 'future-skill',
    version: '1.0.0',
    core_version: '1.0.0',
    adds: [],
    modifies: [],
    min_skills_system_version: '99.0.0',
  });

  const result = await applySkill(skillDir);
  expect(result.success).toBe(false);
  expect(result.error).toContain('99.0.0');
});
```

**Exception Testing:**
```typescript
it('readState throws when no state file exists', () => {
  expect(() => readState()).toThrow();
});

it('readState throws when version is newer than current', () => {
  writeStateHelper(tmpDir, {
    skills_system_version: '99.0.0',
    core_version: '1.0.0',
    applied_skills: [],
  });
  expect(() => readState()).toThrow();
});
```

**Status-based Error Testing:**
- Functions that return `{ success: boolean, error?: string }` are tested with assertions on both fields
- Functions that throw are tested with `expect(() => fn()).toThrow()` or `.toThrow(pattern)`

## Database Testing

**Pattern from `src/db.test.ts`:**
```typescript
beforeEach(() => {
  _initTestDatabase();  // Fresh in-memory database for each test
});
```

**Key Pattern:**
- Exported function `_initTestDatabase()` initializes a test-specific in-memory SQLite database
- Each test gets a clean slate
- No mocking of database operations; tests exercise real SQL logic

## Common Assertion Patterns

**Array/Object Assertions:**
```typescript
expect(messages).toHaveLength(1);
expect(messages[0].id).toBe('msg-1');
expect(state.applied_skills).toEqual([{ name: 'skill', version: '1.0.0', file_hashes: {} }]);
```

**File System Assertions:**
```typescript
expect(fs.existsSync(filePath)).toBe(true);
expect(fs.readFileSync(markerFile, 'utf-8').trim()).toBe('applied');
expect(fs.existsSync(path.join(tmpDir, 'src/added.ts'))).toBe(false);
```

**Mock Function Assertions:**
```typescript
expect(processMessages).toHaveBeenCalled();
expect(processMessages).toHaveBeenCalledWith('group1@g.us');
expect(processMessages).toHaveBeenCalledTimes(2);
```

## Configuration

**Main Test Config (`vitest.config.ts`):**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'setup/**/*.test.ts', 'skills-engine/**/*.test.ts'],
  },
});
```

**Skills-Specific Config (`vitest.skills.config.ts`):**
- May override or extend for skills-engine-specific settings

**Coverage Requirements:**
- Not enforced (no coverage threshold configured)
- Use `npm run test -- --coverage` to generate reports

---

*Testing analysis: 2026-03-22*
