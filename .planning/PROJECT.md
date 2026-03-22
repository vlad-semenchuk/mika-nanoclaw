# NanoClaw Observability

## What This Is

Basic observability for NanoClaw — a Node.js orchestrator that routes WhatsApp/Telegram messages to Claude agents running in containers. Adds Prometheus metrics, structured logging improvements, and a Grafana dashboard so the operator can see what's happening inside the system.

## Core Value

The operator can quickly tell if the system is healthy and diagnose where things go wrong when they do.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Prometheus metrics exposed via `/metrics` HTTP endpoint
- [ ] Message flow counters (received, processed, failed)
- [ ] Container lifecycle metrics (spawned, running, crashed, duration)
- [ ] Agent performance metrics (API calls, token usage, response time)
- [ ] Node.js process metrics (memory, CPU, event loop lag)
- [ ] Migrate remaining console.log calls to existing Pino logger
- [ ] Structured log context (message IDs, group names, container IDs)
- [ ] JSON log transport for production (Loki-friendly)
- [ ] Docker Compose for Prometheus + Grafana
- [ ] Prometheus scrape config targeting NanoClaw /metrics
- [ ] Pre-built Grafana dashboard with key panels

### Out of Scope

- Distributed tracing (OpenTelemetry spans) — too complex for v1, revisit later
- Loki log aggregation — keep logs on disk for now, add Loki when needed
- Alerting rules — get dashboards working first, then define alert thresholds
- APM / error tracking services (Sentry, Datadog) — keeping it self-hosted
- Metrics from inside agent containers — only instrument the orchestrator process

## Context

- NanoClaw is a single Node.js process (`src/index.ts`) that orchestrates everything
- Already has Pino logger (`src/logger.ts`) but it's barely used — most files still use `console.log`
- No existing metrics or monitoring infrastructure
- Runs on macOS (dev) and Linux VPS (prod), both need to work
- Docker Compose already conceptually familiar (containers used for agent execution)
- Key subsystems to instrument: message loop, group queue, container runner, task scheduler, IPC watcher
- SQLite database at `store/messages.db` for state persistence
- Channels: Telegram (grammy), WhatsApp support

## Constraints

- **Runtime**: Node.js 22, TypeScript 5.7, ES2022 target
- **Metrics lib**: `prom-client` (standard Prometheus client for Node.js)
- **Logging**: Pino 9.x (already installed)
- **Infrastructure**: Docker Compose for Prometheus + Grafana (not installed on host)
- **Simplicity**: Start minimal — counters, histograms, gauges. No custom collectors or complex aggregations
- **Dual environment**: Must work on macOS (dev) and Linux (prod)

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| prom-client for metrics | De facto standard for Node.js + Prometheus, widely supported | — Pending |
| Dedicated HTTP port for /metrics | Keep metrics endpoint separate from any future HTTP API | — Pending |
| Docker Compose for Prom+Grafana | Simplest way to run monitoring stack alongside NanoClaw | — Pending |
| JSON logs in prod, pretty in dev | Pino supports both via transports; JSON is Loki-ready when needed | — Pending |
| Instrument orchestrator only | Agent containers are ephemeral; instrumenting them adds complexity for little value in v1 | — Pending |

---
*Last updated: 2026-03-22 after initialization*
