import http from 'http';

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

// Singleton registry — import this everywhere metrics are defined.
// Never use prom-client's global `register`; always use this custom instance.
export const registry = new Registry();

// Collect default Node.js/process metrics once at module scope.
collectDefaultMetrics({ register: registry });

// Container lifecycle metrics (CONT-01 to CONT-04)

/** Counts total container spawns per group. */
export const containerSpawnTotal = new Counter({
  name: 'nanoclaw_container_spawn_total',
  help: 'Total number of container spawns per group',
  labelNames: ['group'] as const,
  registers: [registry],
});

/** Counts container failures with reason label. */
export const containerFailureTotal = new Counter({
  name: 'nanoclaw_container_failure_total',
  help: 'Total number of container failures per group and reason (timeout, exit_error, spawn_error)',
  labelNames: ['group', 'reason'] as const,
  registers: [registry],
});

/** Histogram of container run durations in seconds. */
export const containerDurationSeconds = new Histogram({
  name: 'nanoclaw_container_duration_seconds',
  help: 'Container run duration in seconds',
  labelNames: ['group'] as const,
  buckets: [5, 10, 20, 30, 60, 90, 120, 180, 300, 600],
  registers: [registry],
});

/** Gauge tracking how many containers are currently running. */
export const containersActive = new Gauge({
  name: 'nanoclaw_containers_active',
  help: 'Number of currently active (running) containers',
  registers: [registry],
});

// Message flow metrics (MSG-01 to MSG-03)

/** Counts inbound messages per group and channel. */
export const messagesReceivedTotal = new Counter({
  name: 'nanoclaw_messages_received_total',
  help: 'Total inbound messages per group and channel',
  labelNames: ['group', 'channel'] as const,
  registers: [registry],
});

/** Histogram of message processing latency (message arrival → agent start). */
export const messageProcessingLatencySeconds = new Histogram({
  name: 'nanoclaw_message_processing_latency_seconds',
  help: 'Time from oldest pending message to agent processing start in seconds',
  labelNames: ['group'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

/** Histogram of messages batched per agent invocation. */
export const messageBatchSize = new Histogram({
  name: 'nanoclaw_message_batch_size',
  help: 'Number of messages batched per agent invocation',
  labelNames: ['group'] as const,
  buckets: [1, 2, 3, 5, 10, 20, 50],
  registers: [registry],
});

// Queue & concurrency metrics (QUEUE-01 to QUEUE-03)

/** Gauge of groups waiting for a concurrency slot. */
export const queueWaitingGroups = new Gauge({
  name: 'nanoclaw_queue_waiting_groups',
  help: 'Number of groups waiting for a free concurrency slot',
  registers: [registry],
});

/** Histogram of time groups spend waiting for a concurrency slot. */
export const queueWaitSeconds = new Histogram({
  name: 'nanoclaw_queue_wait_seconds',
  help: 'Time a group waits for a free concurrency slot in seconds',
  labelNames: ['group'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});

/** Counts messages dropped after max retries exceeded. */
export const maxRetriesExceededTotal = new Counter({
  name: 'nanoclaw_max_retries_exceeded_total',
  help: 'Messages dropped after exceeding max retry attempts',
  labelNames: ['group'] as const,
  registers: [registry],
});

// Task execution metrics (TASK-01 to TASK-02)

/** Counts task execution outcomes. */
export const taskExecutionResultTotal = new Counter({
  name: 'nanoclaw_task_execution_result_total',
  help: 'Task execution outcomes by status',
  labelNames: ['status'] as const,
  registers: [registry],
});

/** Histogram of task execution durations. */
export const taskExecutionDurationSeconds = new Histogram({
  name: 'nanoclaw_task_execution_duration_seconds',
  help: 'Scheduled task execution duration in seconds',
  buckets: [5, 10, 20, 30, 60, 90, 120, 180, 300, 600],
  registers: [registry],
});

// Agent invocation metrics (AGNT-01 to AGNT-02)

/** Counts total agent invocations. */
export const agentInvocationTotal = new Counter({
  name: 'nanoclaw_agent_invocation_total',
  help: 'Total number of agent invocations',
  registers: [registry],
});

/** Histogram of agent end-to-end durations in seconds. */
export const agentDurationSeconds = new Histogram({
  name: 'nanoclaw_agent_duration_seconds',
  help: 'Agent end-to-end duration in seconds (from invocation to completion)',
  buckets: [5, 10, 20, 30, 60, 90, 120, 180, 300, 600],
  registers: [registry],
});

let server: http.Server | null = null;

/**
 * Start the Prometheus metrics HTTP server on the given port.
 * Binds to the specified address (default 0.0.0.0).
 * Serves GET /metrics → 200 with Prometheus text format.
 * All other paths → 404.
 */
export function startMetricsServer(port: number, bind = '0.0.0.0'): void {
  server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      try {
        const body = await registry.metrics();
        res.writeHead(200, { 'Content-Type': registry.contentType });
        res.end(body);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, bind);
}

/**
 * Returns the underlying HTTP server instance, or null if not started.
 * Exposed for testing purposes only.
 */
export function getMetricsServer(): http.Server | null {
  return server;
}

/**
 * Stop the metrics HTTP server gracefully.
 * Safe to call even if the server is not running.
 */
export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
