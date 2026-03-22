# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**Messaging:**
- Telegram - Chat platform for message receiving/sending
  - SDK/Client: grammy 1.39.3
  - Auth: `TELEGRAM_BOT_TOKEN` (env var)
  - Implementation: `src/channels/telegram.ts` (TelegramChannel class)

**LLM/AI:**
- Claude (Anthropic) - Primary agent backend running in containers
  - Auth mode: API key (`ANTHROPIC_API_KEY`) or OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`)
  - Credential proxy: `src/credential-proxy.ts` — proxy intercepts container requests and injects real credentials
  - Base URL configurable: `ANTHROPIC_BASE_URL` (defaults to https://api.anthropic.com)

**Voice Transcription:**
- Groq Whisper API - Preferred voice transcription (free tier recommended)
  - SDK/Client: openai 6.32.0 (with custom baseURL proxying)
  - Auth: `GROQ_API_KEY` (env var, takes precedence)
  - Endpoint: https://api.groq.com/openai/v1
  - Model: whisper-large-v3-turbo

- OpenAI Whisper API - Fallback transcription
  - SDK/Client: openai 6.32.0
  - Auth: `OPENAI_API_KEY` (env var, used if GROQ_API_KEY not set)
  - Model: whisper-1
  - Implementation: `src/transcription.ts`

## Data Storage

**Databases:**
- SQLite (better-sqlite3)
  - Local file: `store/messages.db`
  - Contains: Chat metadata, messages, scheduled tasks, router state, sessions, group registrations
  - Client: better-sqlite3 11.8.1
  - Auto-migrations on startup for schema evolution

**File Storage:**
- Local filesystem only
  - Project root: `.env`, group folders under `groups/`
  - Group state: `groups/{group_name}/CLAUDE.md` (per-group memory)
  - Mounted into containers with security restrictions

**Caching:**
- In-memory: lastAgentTimestamp, registeredGroups, sessions (loaded from SQLite on startup)
- No external cache service (Redis, Memcached, etc.)

## Authentication & Identity

**Auth Provider:**
- Custom dual-mode system for Claude API access
  - API Key mode: Direct `x-api-key` header injection on all requests
  - OAuth mode: Placeholder token from container exchanged via `/api/oauth/claude_cli/create_api_key` endpoint
  - Implementation: `src/credential-proxy.ts` (startCredentialProxy function)

**User/Chat Identification:**
- Telegram chat IDs (format: `tg:{chatId}`)
- Internal group JID mapping in `registered_groups` SQLite table
- Sender allowlist: `~/.config/nanoclaw/sender-allowlist.json` (outside project, never mounted)

## Monitoring & Observability

**Error Tracking:**
- None (no external error service like Sentry)

**Logs:**
- Pino structured logging with JSON output
- Console prettification via pino-pretty in development
- Log level configurable: `LOG_LEVEL` env var (default: 'info')
- Uncaught exceptions and unhandled rejections routed through pino
- Implementation: `src/logger.ts`

## CI/CD & Deployment

**Hosting:**
- Self-hosted (runs on user's machine as launchd service on macOS, systemd on Linux)
- Runs as single Node.js process managing agent containers

**CI Pipeline:**
- None detected (no GitHub Actions, CircleCI, etc.)
- npm scripts for local development: `build`, `test`, `lint`, `format`

## Environment Configuration

**Required env vars:**
- `TELEGRAM_BOT_TOKEN` - Telegram bot token for message channel
- `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` - Claude API authentication

**Optional env vars:**
- `GROQ_API_KEY` - Groq API key for voice transcription (recommended over OpenAI)
- `OPENAI_API_KEY` - OpenAI API key for transcription (fallback)
- `ASSISTANT_NAME` - Display name for the assistant (default: 'Andy')
- `ASSISTANT_HAS_OWN_NUMBER` - Boolean flag for WhatsApp configuration (legacy)
- `TELEGRAM_ONLY` - If true, disable WhatsApp channel
- `CONTAINER_TIMEOUT` - Max execution time per container (default: 1800000ms / 30min)
- `CONTAINER_MAX_OUTPUT_SIZE` - Max output size from container (default: 10485760 bytes / 10MB)
- `CREDENTIAL_PROXY_PORT` - HTTP proxy port for credential injection (default: 3001)
- `IDLE_TIMEOUT` - Keep container alive after last result (default: 1800000ms / 30min)
- `MAX_CONCURRENT_CONTAINERS` - Max running agent containers (default: 5)
- `TZ` - Timezone for cron/scheduled tasks (system timezone if not set)
- `CONTAINER_IMAGE` - Docker image name for agents (default: 'nanoclaw-agent:latest')
- `LOG_LEVEL` - Pino log level (default: 'info')
- `ANTHROPIC_BASE_URL` - Custom Claude API endpoint (defaults to https://api.anthropic.com)

**Secrets location:**
- `.env` file in project root (contains API keys and tokens)
- NOT committed to git (.env in .gitignore)
- Mount allowlist: `~/.config/nanoclaw/mount-allowlist.json` (outside project, for security)
- Sender allowlist: `~/.config/nanoclaw/sender-allowlist.json` (outside project, for security)

## Container Communication

**IPC (Inter-Process Communication):**
- File-based IPC via named pipes and sentinel-marked output in container stdout
- Sentinel markers: `---NANOCLAW_OUTPUT_START---` and `---NANOCLAW_OUTPUT_END---`
- Container output parsing: `src/container-runner.ts` (lines 34-36)
- IPC watcher: `src/ipc.ts` (watches for container task results)

**Credential Proxy:**
- HTTP proxy running on `CREDENTIAL_PROXY_PORT` (default: localhost:3001)
- Containers connect to proxy instead of Anthropic API directly
- Proxy injects real credentials (API key or OAuth token) on every request
- Location: `src/credential-proxy.ts`

## Webhooks & Callbacks

**Incoming:**
- None (polling-based for message retrieval)

**Outgoing:**
- Telegram message sending via grammy
- Scheduled task output routed back to original chat via `routeOutbound()`
- No external webhooks configured

## External Tool Access

**Browser Automation:**
- agent-browser (installed globally in container)
- Executable: Chromium at `/usr/bin/chromium`
- Available to all agents via Bash in containers

**Code Execution:**
- claude-code (installed globally in container)
- Provides code generation and execution capabilities

---

*Integration audit: 2026-03-22*
