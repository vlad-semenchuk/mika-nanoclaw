# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Orchestrator with containerized agent execution and isolated group processing.

**Key Characteristics:**
- Single Node.js process orchestrates message routing and agent lifecycle
- Each registered group (WhatsApp/Telegram chat) has an isolated container with its own filesystem
- Credentials are isolated via a credential proxy — containers never see API keys
- Message-driven: agents are invoked by incoming messages or scheduled tasks
- Polling-based for simplicity (no webhooks to manage)

## Layers

**Orchestrator (src/index.ts):**
- Purpose: Central coordinator for the entire system
- Location: `src/index.ts`
- Contains: Message loop, state management, agent invocation, group registration
- Depends on: All subsystems (database, channels, container runner, task scheduler, IPC watcher, group queue)
- Used by: Main process entry point

**Channel Layer (src/channels/):**
- Purpose: Platform-specific message transport (WhatsApp, Telegram)
- Location: `src/channels/telegram.ts` (WhatsApp would be in same directory)
- Contains: Connection logic, message sending/receiving, typing indicators, message formatting for platform
- Depends on: Config, types, database (for metadata), formatting utilities
- Used by: Orchestrator for inbound/outbound message routing

**Container Runtime (src/container-runner.ts, src/container-runtime.ts):**
- Purpose: Spawns agent containers, manages I/O, collects output
- Location: `src/container-runner.ts` (execution), `src/container-runtime.ts` (abstraction layer)
- Contains: Docker invocation, environment setup, mount configuration, output parsing
- Depends on: Config, group-folder validation, credential proxy, mount security validation
- Used by: Orchestrator and task scheduler to execute agents

**Message Processing (src/group-queue.ts):**
- Purpose: Fair-share scheduling across groups with concurrency limits
- Location: `src/group-queue.ts`
- Contains: Group state tracking, message/task queuing, process lifecycle management, retry logic
- Depends on: Logger
- Used by: Orchestrator and scheduler to coordinate container execution

**Task Scheduler (src/task-scheduler.ts):**
- Purpose: Runs scheduled tasks (cron, interval, one-time) in containers
- Location: `src/task-scheduler.ts`
- Contains: Cron parsing, next-run computation, task polling, task execution
- Depends on: Group queue, database, container runner, config
- Used by: Orchestrator as a background loop

**Message Storage & Retrieval (src/db.ts):**
- Purpose: SQLite persistence for messages, groups, sessions, scheduled tasks
- Location: `src/db.ts`
- Contains: Schema, CRUD operations for all persistent data
- Depends on: better-sqlite3, types, config
- Used by: All layers (orchestrator, channels, task scheduler, IPC watcher)

**IPC (Inter-Process Communication) Watcher (src/ipc.ts):**
- Purpose: Allows agents to send messages or create tasks back to the orchestrator
- Location: `src/ipc.ts`
- Contains: File-system polling of group IPC directories, authorization checks, message/task creation
- Depends on: Database, group folder validation, types
- Used by: Orchestrator as a background loop

**Credential Proxy (src/credential-proxy.ts):**
- Purpose: HTTP proxy that injects credentials so containers never see them
- Location: `src/credential-proxy.ts`
- Contains: HTTP server, request forwarding, credential injection for API key or OAuth
- Depends on: Environment reading, logger
- Used by: Containers connect to this instead of direct API

**Routing & Formatting (src/router.ts):**
- Purpose: Format messages for agent prompts, route responses to correct channel
- Location: `src/router.ts`
- Contains: XML formatting, platform-specific output cleanup, channel lookup
- Depends on: Types, timezone utilities
- Used by: Orchestrator and channels

## Data Flow

**Inbound Message Path:**

1. Channel (Telegram/WhatsApp) receives message
2. Channel invokes `onMessage` callback → `storeMessage()` in database
3. Orchestrator polling loop (`startMessageLoop`) detects new messages via `getNewMessages()`
4. Orchestrator filters by group and trigger pattern (@ mentions)
5. Orchestrator deduplicates by group and pulls all pending context
6. GroupQueue enqueues the group for processing or pipes to active container
7. Container receives formatted messages via stdin, processes with Claude Agent
8. Container outputs results to stdout (parsed between markers)
9. Orchestrator sends results back to channel via `channel.sendMessage()`

**Scheduled Task Path:**

1. Scheduler loop (`startSchedulerLoop`) polls database for due tasks
2. For each due task, queries registered group and session ID
3. Invokes container runner with task prompt
4. Container executes with task context
5. On completion, logs result and computes next run time
6. Sends task output to group chat via channel

**Agent Output Path:**

1. Container streams output line by line
2. Orchestrator parses output between markers (OUTPUT_START/END)
3. Extracts `result` field from JSON
4. Strips `<internal>...</internal>` tags (agent's private reasoning)
5. Formats platform-specific output via `formatOutbound()`
6. Routes to correct channel via `findChannel()`
7. Channel sends to chat/user

**Group Isolation:**

1. Each group gets its own container with independent `/workspace/group` mount
2. Container has readonly access to project root (src, dist, package.json)
3. Env file shadowed with `/dev/null` — credentials never visible
4. Containers connect to credential proxy (not directly to APIs)
5. Group folder structure isolated: `/groups/{folder}/` contains group-specific memory

**State Management:**

- Orchestrator maintains in-memory state for channels, sessions, registered groups, message cursors
- Database stores: groups, messages, sessions, scheduled tasks, router state
- On startup, `loadState()` restores cursors to resume from last processed message
- `saveState()` persists cursors after advancing (before processing, so crashes roll back)

## Key Abstractions

**Channel Interface:**
- Purpose: Abstract message transport (WhatsApp, Telegram, Discord, etc.)
- Examples: `src/channels/telegram.ts`, WhatsApp would implement same interface
- Pattern: Implements `Channel` interface with `connect()`, `sendMessage()`, `setTyping()`, `syncGroups()`
- Callback-based: reports inbound messages and metadata via registered callbacks

**RegisteredGroup:**
- Purpose: Represents a chat/group linked to agent
- Examples: Database and in-memory lookup in orchestrator
- Pattern: Contains group name, folder, trigger pattern, container config, session ID
- Scope: One group may map to multiple chat JIDs (in theory), but typically one-to-one

**GroupQueue (Fair-Share Scheduler):**
- Purpose: Enforce fair distribution across groups with concurrency limits
- Pattern: Tracks per-group state (active, pending, retries), respects MAX_CONCURRENT_CONTAINERS
- Behavior: Groups waiting above concurrency limit are queued; when a group finishes, next waiter is promoted

**Mount Allowlist:**
- Purpose: Security — prevents agents from accessing sensitive host paths
- Pattern: Located at `~/.config/nanoclaw/mount-allowlist.json`, never mounted into containers
- Behavior: Whitelist of allowed directories and glob patterns for blocked paths

## Entry Points

**Main Process:**
- Location: `src/index.ts` lines 407-485
- Triggers: `node dist/index.js` or `npm start`
- Responsibilities: Initialize database, start channels, start orchestrator loops (messages, scheduler, IPC), setup graceful shutdown

**Channel Entry Points:**
- Telegram: `startTelegram()` method, triggered by `TELEGRAM_BOT_TOKEN` env var
- Each channel listens for inbound messages asynchronously

**Container Execution:**
- Triggered by: GroupQueue calling `runContainerAgent()` from `processGroupMessages()` or task scheduler
- Entry into container: Agent runner script reads prompt from stdin, invokes Claude Agent SDK

## Error Handling

**Strategy:** Rollback cursors on agent errors, retry with exponential backoff, log all errors.

**Patterns:**

**Message Processing Errors:**
- If agent returns error and no output was sent to user, rollback `lastAgentTimestamp[chatJid]` so message is reprocessed
- If output was already sent, keep cursor advanced to avoid duplicate messages
- Retry loop: `processGroupMessages()` returns boolean; false triggers retry via GroupQueue

**Container Errors:**
- Container spawn failures caught in try-catch in `runAgent()`
- Output parsing errors trigger error status in ContainerOutput
- Container timeout triggers cleanup via `stopContainer()`

**Database Errors:**
- Schema creation errors logged but swallowed (migration is best-effort)
- Query errors propagate up to caller

**Channel Errors:**
- Message send failures propagate to caller (task scheduler or orchestrator)
- Connection loss handled via channel's `connect()` logic (implementation-specific)

## Cross-Cutting Concerns

**Logging:** `src/logger.ts` exports pino logger instance. All subsystems use `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`.

**Validation:** Group folder names validated via `isValidGroupFolder()` before use in paths. Mount paths validated by mount-security module before mounting.

**Authentication:** Credentials handled exclusively by credential proxy. Containers never have direct access to API keys or OAuth tokens.

**Concurrency:** GroupQueue enforces `MAX_CONCURRENT_CONTAINERS` limit. Exceeding limit queues groups rather than spawning unbounded containers.

---

*Architecture analysis: 2026-03-22*
