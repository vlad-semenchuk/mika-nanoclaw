# Codebase Structure

**Analysis Date:** 2026-03-22

## Directory Layout

```
mika/
├── src/                          # Main orchestrator (Node.js)
│   ├── channels/                 # Platform-specific transport layers
│   ├── index.ts                  # Orchestrator main loop
│   ├── container-runner.ts       # Spawn containers and collect output
│   ├── container-runtime.ts      # Docker abstraction layer
│   ├── group-queue.ts            # Fair-share scheduling across groups
│   ├── task-scheduler.ts         # Cron/interval task execution
│   ├── ipc.ts                    # Agent → Orchestrator communication
│   ├── credential-proxy.ts       # Proxy for credential injection
│   ├── db.ts                     # SQLite persistence
│   ├── router.ts                 # Message formatting and routing
│   ├── config.ts                 # Config from environment
│   ├── types.ts                  # TypeScript interfaces
│   ├── group-folder.ts           # Group path validation/resolution
│   ├── mount-security.ts         # Mount allowlist validation
│   ├── logger.ts                 # Pino logger instance
│   ├── env.ts                    # Environment file reading
│   ├── timezone.ts               # Timezone utilities
│   ├── transcription.ts          # Audio transcription
│   └── formatting.test.ts        # (test files)
├── groups/                       # Persistent group storage
│   ├── main/                     # Main control group (elevated privileges)
│   ├── {groupName}/              # Per-group folders
│   │   ├── CLAUDE.md             # Group-specific memory/config
│   │   ├── logs/                 # Container logs
│   │   └── [group-specific files]
│   └── global/                   # Shared resources (reserved)
├── container/                    # Agent container definition
│   ├── Dockerfile                # Agent image build
│   ├── agent-runner/             # Agent execution harness
│   │   └── src/                  # Agent entry point scripts
│   └── skills/                   # Built-in skills/capabilities
├── data/                         # Runtime data
│   ├── ipc/                      # Inter-process communication
│   │   └── {groupFolder}/        # Per-group IPC directory
│   │       ├── messages/         # Messages from agents to orchestrator
│   │       └── tasks/            # Task requests from agents
│   ├── sessions/                 # Session tokens for agents
│   └── nanoclaw.db               # SQLite database
├── store/                        # Customization storage
│   ├── channels.json             # Custom channel configurations
│   ├── skills.json               # Installed skills metadata
│   └── [other state files]
├── docs/                         # Documentation
│   ├── REQUIREMENTS.md           # Architecture decisions
│   └── superpowers/              # Feature specs and plans
├── .claude/                      # Claude-specific configuration
│   ├── skills/                   # Custom skills
│   └── rules/                    # Coding guidelines
├── .planning/                    # GSD planning documents
│   └── codebase/                 # Maps and analysis
├── setup/                        # First-time setup scripts
├── scripts/                      # Utility scripts
├── dist/                         # Compiled JavaScript (generated)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # Project overview
```

## Directory Purposes

**src/:**
- Purpose: All Node.js orchestrator code
- Contains: Channels, container management, task scheduling, message routing, database
- Key files: `index.ts` (entry point), `container-runner.ts`, `db.ts`, `group-queue.ts`

**src/channels/:**
- Purpose: Platform-specific message transport implementations
- Contains: Telegram bot logic, WhatsApp (when added), Discord (when added)
- Key files: `telegram.ts`

**groups/:**
- Purpose: Isolated storage for each registered group
- Contains: Per-group memory (CLAUDE.md), logs, group-specific configs
- Behavior: One folder per group JID; main group in `groups/main/` with elevated privileges
- Generated: Yes (created on first group registration)

**container/:**
- Purpose: Agent container image definition
- Contains: Dockerfile, entry point scripts, built-in skills
- Key files: `Dockerfile`, `agent-runner/src/` (agent harness)

**data/:**
- Purpose: Runtime state and IPC
- Contains: SQLite database, session tokens, IPC directories
- Key files: `nanoclaw.db` (persistent database)
- Generated: Yes (created on startup)

**data/ipc/:**
- Purpose: Filesystem-based communication from agents to orchestrator
- Structure: `data/ipc/{groupFolder}/messages/` for message files, `data/ipc/{groupFolder}/tasks/` for task files
- Behavior: Orchestrator polls and deletes processed files

**store/:**
- Purpose: User customizations and state
- Contains: Channel configs, installed skills, feature toggles
- Generated: Yes (created during setup)

**dist/:**
- Purpose: Compiled JavaScript (excluded from git)
- Generated: Yes (`npm run build` produces this)
- Note: Service runs from here, not from `src/`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Main process orchestrator (orchestrator loop, group queue, channels)
- `container/agent-runner/src/`: Entry point inside agent containers

**Configuration:**
- `src/config.ts`: All config constants (triggers, paths, ports, timeouts)
- `.env`: Environment variables (read by config.ts and credential proxy)
- `groups/{name}/CLAUDE.md`: Per-group memory and config

**Core Logic:**
- `src/container-runner.ts`: Container spawning and I/O management
- `src/group-queue.ts`: Fair-share scheduling across groups
- `src/task-scheduler.ts`: Cron/interval task execution
- `src/ipc.ts`: Agent-to-orchestrator communication
- `src/db.ts`: SQLite operations

**Utilities:**
- `src/router.ts`: Message formatting and channel routing
- `src/group-folder.ts`: Group path validation and resolution
- `src/mount-security.ts`: Allowlist-based mount validation
- `src/credential-proxy.ts`: Credential injection proxy
- `src/logger.ts`: Pino logger instance

**Testing:**
- `src/{file}.test.ts`: Unit tests co-located with source files (e.g., `src/db.test.ts`, `src/group-queue.test.ts`)
- `src/channels/telegram.test.ts`: Channel-specific tests

## Naming Conventions

**Files:**
- Hyphenated lowercase: `container-runner.ts`, `group-queue.ts`, `credential-proxy.ts`
- Test files suffix with `.test.ts`: `db.test.ts`, `task-scheduler.test.ts`
- Channel files in `src/channels/{platform}.ts`: `telegram.ts`, `whatsapp.ts` (when added)

**Directories:**
- Lowercase, pluralized for collections: `src/channels/`, `groups/`, `docs/`, `scripts/`
- Underscored for group-specific: `data/ipc/{groupFolder}/`
- Hyphenated for features: `container/agent-runner/`, `container/skills/`

**TypeScript:**
- Interfaces: PascalCase (e.g., `RegisteredGroup`, `ContainerInput`, `Channel`)
- Functions: camelCase (e.g., `resolveGroupFolderPath()`, `findChannel()`)
- Constants: UPPER_SNAKE_CASE (e.g., `TRIGGER_PATTERN`, `MAX_CONCURRENT_CONTAINERS`)
- Private fields in classes: camelCase with underscore prefix (e.g., `this._shuttingDown`)

## Where to Add New Code

**New Message Channel (Telegram/Discord/etc):**
- Implementation: `src/channels/{platform}.ts`
- Implement the `Channel` interface from `src/types.ts`
- Register in orchestrator (`src/index.ts` main function, around line 435-442)
- Tests: `src/channels/{platform}.test.ts`

**New Subsystem/Service:**
- Location: `src/{subsystem}.ts` (e.g., `src/notification-service.ts`)
- Start function: Export `startXxxService()` or instantiate class
- Call from: `src/index.ts` main function
- Dependencies: Pass via function parameters or class constructor (dependency injection)
- Tests: Co-located `src/{subsystem}.test.ts`

**New Built-in Skill (available to all agents):**
- Location: `container/skills/{skill-name}/`
- Add skill scripts/documentation in this directory
- Register in: `container/Dockerfile` or agent-runner startup
- Make executable: Agents access via bash (available in container PATH)

**New Utility Function:**
- Location: Depends on category:
  - Message handling: `src/router.ts`
  - Filesystem/group paths: `src/group-folder.ts`
  - Database: `src/db.ts`
  - Or create new file if large enough: `src/{utility}.ts`
- Exports: Add to module exports at top level
- Tests: Create `src/{utility}.test.ts` or add to existing test file

**New Scheduled Feature (runs periodically):**
- Location: Consider extending task scheduler or create new loop in `src/index.ts`
- If it's a background service: Create `startXxxLoop()` in `src/index.ts`
- If it's user-defined: Add to scheduled tasks table in database (via IPC or admin API)

**New Configuration Option:**
- Location: `src/config.ts`
- Pattern: Add to envConfig read or as new const (default value with override)
- Example: `export const MY_FEATURE = process.env.MY_FEATURE === 'true';`

## Special Directories

**.planning/codebase/:**
- Purpose: GSD (Guided Solution Design) analysis documents
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Committed: Yes
- Generated: No (written by analysis tools)

**dist/:**
- Purpose: Compiled output from TypeScript
- Generated: Yes (via `npm run build`)
- Committed: No (.gitignored)

**groups/:**
- Purpose: Per-group persistent storage
- Generated: Yes (on first registration)
- Committed: No (user data)

**data/:**
- Purpose: Runtime data (database, sessions, IPC)
- Generated: Yes (on startup)
- Committed: No (runtime state)

**store/:**
- Purpose: User customizations
- Generated: Yes (during setup)
- Committed: No (configuration)

**.claude/:**
- Purpose: Claude-specific rules and custom skills for this project
- Contents: Rules (git-workflow.md, etc.), custom skill definitions
- Committed: Yes

---

*Structure analysis: 2026-03-22*
