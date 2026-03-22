# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**
- TypeScript 5.7.0 - Main codebase, compiled to ES2022

**Secondary:**
- JavaScript - Container agent-runner, setup scripts

## Runtime

**Environment:**
- Node.js 22.10.0 (ES2022 target)
- Requirement: Node >= 20

**Package Manager:**
- npm (npm-cli, version in package-lock.json)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- grammy 1.39.3 - Telegram bot framework for message handling and chat interaction
- better-sqlite3 11.8.1 - Embedded SQLite database for state and message persistence

**Testing:**
- vitest 4.0.18 - Test runner (configured in `vitest.config.ts`)
- @vitest/coverage-v8 4.0.18 - Coverage reporting

**Build/Dev:**
- tsx 4.19.0 - TypeScript executor for development and setup scripts
- typescript 5.7.0 - TypeScript compiler
- eslint 9.35.0 - Linting
- prettier 3.8.1 - Code formatting
- husky 9.1.7 - Git hooks for pre-commit linting/formatting

## Key Dependencies

**Critical:**
- pino 9.6.0 - Structured logging with JSON output and console prettification
- pino-pretty 13.0.0 - Terminal-friendly log formatting
- yaml 2.8.2 - YAML parsing for configuration and skill definitions
- zod 4.3.6 - Runtime schema validation for configuration and types
- cron-parser 5.5.0 - Cron expression parsing for scheduled task scheduling
- openai 6.32.0 - OpenAI API client (used for Whisper transcription, supports proxying to Groq)

**Infrastructure:**
- @types/better-sqlite3 7.6.12 - Type definitions for sqlite3
- @types/node 22.10.0 - Node.js type definitions
- typescript-eslint 8.35.0 - ESLint support for TypeScript
- @eslint/js 9.35.0 - ESLint core rules
- eslint-plugin-no-catch-all 1.1.0 - Prevents overly broad catch blocks
- globals 15.12.0 - Global variable definitions for ESLint

## Configuration

**Environment:**
- Loaded from `.env` file via `readEnvFile()` in `src/env.ts`
- Required variables: `TELEGRAM_BOT_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `GROQ_API_KEY` (optional)
- Optional: `OPENAI_API_KEY`, `ASSISTANT_NAME`, `TELEGRAM_ONLY`
- Optional container variables: `CONTAINER_TIMEOUT`, `CONTAINER_MAX_OUTPUT_SIZE`, `CREDENTIAL_PROXY_PORT`, `IDLE_TIMEOUT`, `MAX_CONCURRENT_CONTAINERS`
- Variable forwarding: `CONTAINER_ENV_FORWARD` array in `src/config.ts` specifies which env vars are forwarded to agent containers (currently: `GROQ_API_KEY`, `OPENAI_API_KEY`)

**Build:**
- TypeScript compilation: `tsc` (configured in `tsconfig.json`, outputs to `dist/`)
- Source maps enabled for debugging
- Strict type checking enabled

**Code Quality:**
- Prettier config: `singleQuote: true` in `.prettierrc`
- ESLint: Detects via standard config discovery (no explicit config file checked in)
- Pre-commit hooks via husky (enforces format/lint)

## Platform Requirements

**Development:**
- Node.js 22 (recommended) or >= 20
- npm package manager
- Git (for husky hooks)

**Production:**
- Node.js >= 20
- Linux containers (Docker/containerd) for agent execution
- Chromium/Browser support in agent containers (`container/Dockerfile` installs system dependencies)

## Database

**Local State:**
- SQLite database at `store/messages.db`
- Schema includes tables for: chats, messages, scheduled_tasks, task_run_logs, router_state, sessions, registered_groups
- Auto-migration logic for schema evolution (see `src/db.ts` migrations)
- Fallback: In-memory database for testing (`_initTestDatabase()`)

---

*Stack analysis: 2026-03-22*
