# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

**Deleted Channel Architecture Files:**
- Issue: Files `src/channels/index.ts`, `src/channels/registry.ts`, `src/channels/registry.test.ts`, `src/remote-control.ts`, `src/remote-control.test.ts`, and `src/sender-allowlist.ts` are marked as deleted in git but the refactor is incomplete
- Files: Deleted from `src/channels/` and `src/`
- Impact: Build may fail if code references deleted exports; git history shows incomplete migration away from registry pattern
- Fix approach: Complete the refactor by verifying no imports reference deleted registry or remote-control modules, update git to commit these deletions, or restore if the pattern is still needed

**Large Monolithic Files:**
- Issue: `src/container-runner.ts` (729 lines) handles container lifecycle, mounts, output parsing, logging, and timeout management. `src/db.ts` (697 lines) manages schema, migrations, and all SQLite operations
- Files: `src/container-runner.ts`, `src/db.ts`
- Impact: Difficult to test individual concerns; timeout logic intertwined with output streaming; schema migrations mixed with query logic
- Fix approach: Break container-runner into separate modules for mount building, argument construction, output parsing, and timeout management. Extract schema and migration logic from db.ts into separate module

**Uneven Error Handling Coverage:**
- Issue: 34 `catch` blocks across codebase but `src/index.ts` (485 lines) has only 3, `src/group-queue.ts` (365 lines) has 8 catches. Some paths return silently on error without logging (e.g., `src/group-queue.ts:176` returns false on write failure)
- Files: `src/index.ts`, `src/group-queue.ts`, `src/task-scheduler.ts`
- Impact: Silent failures in IPC message writing or close sentinel creation could mask infrastructure problems; operator has no visibility into why messages aren't being sent
- Fix approach: Ensure all error paths log at minimum debug level; return both success boolean and error detail where possible; add structured logging for IPC write failures

**In-Memory State Not Atomically Synced with Database:**
- Issue: `src/index.ts` loads state into memory (line 64-79: `lastTimestamp`, `sessions`, `registeredGroups`, `lastAgentTimestamp`) and saves periodically. Race between memory update and DB write means crash between lines 157-159 loses progress
- Files: `src/index.ts` (lines 81-87), `src/index.ts` (lines 155-159)
- Impact: On orchestrator crash, processed message cursors may roll back; duplicate messages sent to user; orphaned idle containers
- Fix approach: Use database as source of truth; read state on-demand rather than caching. Or implement write-ahead logging for cursor updates before advancing them

**Container Output Parsing Fragility:**
- Issue: `src/container-runner.ts` (lines 362-390) parses JSON between sentinel markers. If container writes markers unfinished or in wrong format, the parse buffer accumulates forever or silently fails (line 384-388)
- Files: `src/container-runner.ts` (lines 336-390)
- Impact: Malformed agent output (e.g., partial output during crash) leads to silent failures or memory leak in parseBuffer
- Fix approach: Add parseBuffer size limit; implement timeout-based flush of unpaired markers; log parse failures with sample of actual output

**Task Scheduling Race Condition:**
- Issue: `src/task-scheduler.ts` (line 261) re-checks task status but doesn't hold a lock. Between the check and `deps.queue.enqueueTask()`, the task status could change
- Files: `src/task-scheduler.ts` (lines 258-268)
- Impact: Paused/deleted task could be enqueued anyway; duplicate runs if scheduler polls while queue is processing same task
- Fix approach: Mark task as "running" before enqueueing; use atomic update pattern in database (UPDATE ... WHERE status = 'active' AND id = ?)

**Missing Backpressure in Message Loop:**
- Issue: `src/index.ts` (line 310-384) infinite loop polls for messages every POLL_INTERVAL but doesn't rate-limit or batch queuing. If 1000 messages arrive, all get queued immediately
- Files: `src/index.ts` (lines 310-384)
- Impact: GroupQueue fills beyond `MAX_CONCURRENT_CONTAINERS`; messages may be dropped if waitingGroups becomes too large
- Fix approach: Apply token bucket or sliding window rate limiter to message queueing; log queue depth to monitor

---

## Known Issues

**Container Timeout Grace Period Logic Unverified:**
- Symptoms: Container stops gracefully at IDLE_TIMEOUT + 30s hard timeout, but the grace period (30s) may be insufficient if container is waiting on MCP calls or network I/O
- Files: `src/container-runner.ts` (lines 415-445)
- Trigger: Long-running MCP operations (file I/O, web scraping) or network delays
- Workaround: Increase IDLE_TIMEOUT in config or reduce operation timeout in container config
- Impact: Containers killed before completing valid work; user sees no response

**IPC Message File Race Condition:**
- Symptoms: Message loses data or file appears empty if host crashes between `writeFileSync(tempPath)` and `renameSync(tempPath, filepath)`
- Files: `src/group-queue.ts` (lines 168-173)
- Trigger: Host crash during IPC message write
- Workaround: Recover from IPC directory on restart; messages are re-pulled from DB
- Impact: Message lost if not yet processed

**SQL Injection via Task ID in Logs:**
- Symptoms: Not an injection vulnerability (SQL uses prepared statements), but `taskId` is logged verbatim from user input in `src/task-scheduler.ts` (line 107) and could contain binary data
- Files: `src/task-scheduler.ts` (lines 106-109)
- Trigger: Manually crafted task ID in database
- Workaround: Log JSON with sanitized taskId (current logging does this via structured logger)
- Impact: Log file corruption unlikely due to structured logging

---

## Security Considerations

**Environment Variable Fallback Complexity:**
- Risk: `src/container-runner.ts` (lines 248-254) reads from both `process.env` and `.env` file as fallback for whitelisted vars. If `.env` is compromised (e.g., git commit accident), stale credentials could be forwarded to containers
- Files: `src/container-runner.ts` (lines 246-254), `src/env.ts`
- Current mitigation: `.env` is shadowed at container runtime (line 84-90); process.env takes precedence
- Recommendations: Document that `.env` fallback is for initialization only; add validation that CONTAINER_ENV_FORWARD only includes non-secret vars (validate against DEFAULT_BLOCKED_PATTERNS); log warning if `.env` differs from process.env

**Credential Proxy Token Injection Timing:**
- Risk: In OAuth mode, container sends placeholder `CLAUDE_CODE_OAUTH_TOKEN`. Proxy injects real token only on Authorization header presence (line 74-78). If SDK uses cached token without header, proxy cannot inject
- Files: `src/credential-proxy.ts` (lines 65-80)
- Current mitigation: SDK is documented to send auth header on every request
- Recommendations: Add telemetry logging each time proxy injects token; test with SDK versions to ensure header always present

**Mount Allowlist Caching Without Invalidation:**
- Risk: Mount allowlist cached in memory at startup. Changes to `~/.config/nanoclaw/mount-allowlist.json` are not picked up without process restart
- Files: `src/mount-security.ts` (lines 22-24, 54-119)
- Current mitigation: Allowlist is outside project root, containers cannot modify it
- Recommendations: Add file watcher to reload allowlist on change; or add `/debug mount-reload` command to CLI

**Per-Group Session Directory Not Isolated at Container Level:**
- Risk: `src/container-runner.ts` (lines 120-149) mounts group `.claude/` directory writable. If container is compromised, it could read/modify sessions from other groups
- Files: `src/container-runner.ts` (lines 120-149)
- Current mitigation: Sessions are mounted per-group; IPC directories are per-group
- Recommendations: Verify that no group-A container can access /app/sessions/group-B/.claude/ filesystem; use container read-only filesystem with writable tmpfs for temporary state

---

## Performance Bottlenecks

**Database Query N+1 in Task Update:**
- Problem: `src/task-scheduler.ts` (line 260) calls `getTaskById()` which queries DB for every due task. If 100 tasks are due, that's 100+ DB queries
- Files: `src/task-scheduler.ts` (lines 253-268)
- Cause: Defensive re-check of task status between getDueTasks and enqueueing
- Improvement path: Batch query all due tasks with status='active' in a single query; pass result to enqueue logic

**Full Message Scan for Trigger Detection:**
- Problem: `src/index.ts` (line 145-150) scans all messages between triggers with `TRIGGER_PATTERN.test()` on each. With 500 queued messages, this is 500+ regex tests
- Files: `src/index.ts` (lines 144-150)
- Cause: Prefers context completeness over performance
- Improvement path: Add triggerTimestamp index on messages table; only scan since last trigger; add regex cache

**GroupQueue Waiting List Linear Search:**
- Problem: `src/group-queue.ts` (line 75) checks `if (!this.waitingGroups.includes(groupJid))` on every queue operation. With 100+ groups, this is O(n)
- Files: `src/group-queue.ts` (lines 73-77)
- Cause: Simple array implementation
- Improvement path: Use Set for waiting groups

**Container Output Size Limit Not Validated Early:**
- Problem: `src/container-runner.ts` (lines 345-357) accumulates stdout until truncation happens. A single 100MB output line causes memory spike
- Files: `src/container-runner.ts` (lines 344-357)
- Cause: No per-event size check; only total-since-start check
- Improvement path: Check chunk size before appending; truncate immediately if single chunk exceeds limit

---

## Fragile Areas

**Message Cursor Rollback Logic:**
- Files: `src/index.ts` (lines 155-216)
- Why fragile: Three conditions must align for rollback to work correctly:
  1. No output sent to user (`outputSentToUser = false`)
  2. Agent error occurred
  3. Cursor hasn't advanced too far
  If agent sends partial output, then errors, the rollback logic skips rollback (line 208-210). This works but relies on operator understanding this behavior. If in future output streaming changes, this could silently cause duplicates.
- Safe modification: Add explicit comment block explaining the three-way branch; add test for "partial output + error = no rollback" scenario
- Test coverage: `src/index.ts` has no unit tests; this logic is integration-tested only

**Container Timeout and Idle Timeout Interaction:**
- Files: `src/container-runner.ts` (lines 415-445)
- Why fragile: Hard timeout is `Math.max(configTimeout, IDLE_TIMEOUT + 30_000)`. This creates a situation where:
  - If IDLE_TIMEOUT = 30min and configTimeout = 5min, hard timeout becomes 30min (not 5min)
  - Agent that goes idle for 29m59s then does work will not be timed out during that work
  The logic assumes IDLE_TIMEOUT < configTimeout, which is true in current config but not enforced
- Safe modification: Add assertion that IDLE_TIMEOUT < configTimeout in config validation; document this relationship prominently
- Test coverage: `src/container-runner.test.ts` (line 131-150) tests this but only with mocked timers

**IPC Authorization Check Correctness:**
- Files: `src/ipc.ts` (lines 78-94)
- Why fragile: Authorization checks that non-main group can only send to own group. But what if `registeredGroups[data.chatJid]` doesn't exist? Line 80 would skip the check (line 82-83). Currently this is safe because unregistered groups won't receive messages anyway, but if message routing logic changes, this could become a privilege escalation
- Safe modification: Add explicit check that group is registered before message is sent; fail closed on unknown JID
- Test coverage: `src/ipc-auth.test.ts` exists; verify all edge cases covered

**Task Scheduling Without Concurrency Control:**
- Files: `src/task-scheduler.ts` (lines 258-268)
- Why fragile: If scheduler loop runs while same task is being processed, duplicate runs could occur. Currently prevented by queue deduplication in `src/group-queue.ts` (line 96) but that's a weak defense
- Safe modification: Implement explicit "running" status in DB; update task to status='running' before enqueueing; re-check before running
- Test coverage: No test for concurrent scheduler invocations

---

## Scaling Limits

**Message Queue Memory:**
- Current capacity: `MAX_CONCURRENT_CONTAINERS = 4` (from config). Each group can have unlimited pending messages in `GroupQueue.groups.get(jid).pendingMessages` boolean flag
- Limit: If a single group accumulates 1000 messages while 4 containers are active, all 1000 will be re-queued on next check. This is fine because DB is source of truth
- Scaling path: Monitor queue depth; add prometheus metrics for pending message count per group

**Database Connection Pool:**
- Current capacity: better-sqlite3 uses single connection per process. Single orchestrator can handle ~100 groups without DB contention
- Limit: At ~500 active groups, DB write latency becomes noticeable (each message write, task write, cursor update = DB transaction)
- Scaling path: Batch writes into transaction blocks; use WAL mode for concurrent reads

**Container Image Pull Latency:**
- Current capacity: First container startup pulls image if not cached (~5-10s). Subsequent startups use cache
- Limit: If image is 2GB and 100 groups start simultaneously, pull queue becomes bottleneck
- Scaling path: Pre-pull image during startup; use local registry cache

---

## Dependencies at Risk

**better-sqlite3 Native Binding:**
- Risk: Requires native compilation. Installation fails on mismatched Node/Python/compiler versions
- Impact: Setup fails for some users; Docker build may succeed but host node fails
- Migration plan: Consider sqlite (pure JS) for non-critical paths; use better-sqlite3 for main DB only; pre-compile bindings in Docker

**cron-parser Timezone Edge Cases:**
- Risk: DST transitions, leap seconds, etc. may cause cron tasks to skip or double-run
- Impact: Critical tasks (e.g., daily reports) could be missed
- Migration plan: Add unit tests for all DST transitions in configured timezone; consider using node-schedule which handles DST

**grammy Bot API Version Lag:**
- Risk: Telegram Bot API evolves faster than grammy updates. New message types cause parse errors
- Impact: Bot crashes on unrecognized message type
- Migration plan: Add catch-all handler for unknown message types; log and skip gracefully

---

## Missing Critical Features

**No Rate Limiting for Inbound Messages:**
- Problem: If 1000 messages arrive in 1 second, all are queued. No protection against spam/DOS
- Blocks: Cannot safely expose bot in large group chats without rate limiting
- Fix: Add sliding window rate limiter; configurable messages-per-second per group

**No Request Deduplication:**
- Problem: Duplicate messages (network retry, user sends twice) are processed twice by agent
- Blocks: Agent performs work twice; user sees two responses
- Fix: Add message ID deduplication window in router; skip processing if ID seen in last 60s

**No Operational Visibility Dashboard:**
- Problem: No metrics, no real-time queue depth, no container failure trends
- Blocks: Operator cannot see if system is degrading
- Fix: Add prometheus metrics export; add web dashboard for queue depth, error rates, container uptime

**No Graceful Drain Before Shutdown:**
- Problem: On SIGTERM, containers are detached (not killed) but the orchestrator exits immediately. Container processes orphaned
- Blocks: Can't implement zero-downtime updates
- Fix: On SIGTERM, wait for active containers to finish or timeout (configurable); then exit

---

## Test Coverage Gaps

**No Integration Tests for Message Loop:**
- What's not tested: Full path from inbound message → trigger detection → container spawn → output handling → cursor update
- Files: `src/index.ts` (lines 301-385), no corresponding test file
- Risk: Regression in message flow goes undetected until production
- Priority: High

**No Tests for IPC Authorization Bypass:**
- What's not tested: Can non-main group read/write tasks from other groups? Can unregistered group send messages?
- Files: `src/ipc.ts` (lines 78-94, 188-211), partial coverage in `src/ipc-auth.test.ts`
- Risk: Security regression in authorization logic
- Priority: High

**No Tests for Container Timeout Scenarios:**
- What's not tested: Container timeout with no output, partial output, streaming output. timeout + idle cleanup
- Files: `src/container-runner.ts` (lines 415-495), partial coverage in `src/container-runner.test.ts` (line 131+)
- Risk: Timeout behavior changes unexpectedly
- Priority: Medium

**No Tests for Task Concurrency:**
- What's not tested: Two tasks for same group enqueued simultaneously; scheduler loop fires while task running
- Files: `src/group-queue.ts` (lines 90-130), `src/task-scheduler.ts` (lines 251-277)
- Risk: Duplicate task runs or dropped tasks
- Priority: Medium

**No Tests for Database Migration Edge Cases:**
- What's not tested: Upgrade from version without context_mode column; upgrade from version without is_main column
- Files: `src/db.ts` (lines 87-141)
- Risk: Silent data corruption during migration
- Priority: Medium

**No Load Tests:**
- What's not tested: System behavior with 100+ groups, 1000+ messages/second, container failures
- Files: All orchestrator code
- Risk: Scaling limits discovered in production
- Priority: Low (community feature)

---

*Concerns audit: 2026-03-22*
