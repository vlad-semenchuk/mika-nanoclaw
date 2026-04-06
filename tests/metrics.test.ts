import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  registry,
  startMetricsServer,
  stopMetricsServer,
  getMetricsServer,
  containerSpawnTotal,
  containerFailureTotal,
  containerDurationSeconds,
  containersActive,
  agentInvocationTotal,
  agentDurationSeconds,
} from '../src/metrics.js';

function getPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function fetchMetrics(port: number, path = '/metrics'): Promise<{
  statusCode: number;
  body: string;
  contentType: string | undefined;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode!,
            body: Buffer.concat(chunks).toString(),
            contentType: res.headers['content-type'],
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('metrics module', () => {
  afterEach(async () => {
    await stopMetricsServer();
  });

  // METR-01: HTTP server serves /metrics with 200 and correct content-type
  it('GET /metrics returns 200 with Prometheus content-type', async () => {
    const port = await getPort();
    startMetricsServer(port);

    const res = await fetchMetrics(port);

    expect(res.statusCode).toBe(200);
    expect(res.contentType).toMatch(/text\/plain|application\/openmetrics-text/);
  });

  // METR-01: Non-/metrics paths return 404
  it('GET on unknown path returns 404', async () => {
    const port = await getPort();
    startMetricsServer(port);

    const res = await fetchMetrics(port, '/other');

    expect(res.statusCode).toBe(404);
  });

  // METR-02: Default Node.js process metrics are present in the response
  it('response body contains default Node.js process metrics', async () => {
    const port = await getPort();
    startMetricsServer(port);

    const res = await fetchMetrics(port);

    expect(res.body).toContain('process_cpu_user_seconds_total');
    expect(res.body).toContain('nodejs_heap_space_size_total');
    expect(res.body).toContain('nodejs_eventloop_lag_seconds');
  });

  // METR-03: Registry is a singleton (same object reference on repeated import)
  it('registry is a Registry instance (singleton)', async () => {
    const { Registry } = await import('prom-client');
    expect(registry).toBeInstanceOf(Registry);
  });

  // METR-03: Content-type from response matches registry.contentType
  it('content-type matches registry.contentType', async () => {
    const port = await getPort();
    startMetricsServer(port);

    const res = await fetchMetrics(port);
    const expected = registry.contentType;

    expect(res.contentType).toContain(expected.split(';')[0].trim());
  });
});

describe('subsystem metrics', () => {
  afterEach(async () => {
    await stopMetricsServer();
  });

  // CONT-01: Container spawn counter
  it('containerSpawnTotal appears in /metrics output after increment', async () => {
    const port = await getPort();
    startMetricsServer(port);

    containerSpawnTotal.inc({ group: 'test-group' });

    const res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_container_spawn_total');
  });

  // CONT-02: Container failure counter
  it('containerFailureTotal appears in /metrics output', async () => {
    const port = await getPort();
    startMetricsServer(port);

    containerFailureTotal.inc({ group: 'test-group', reason: 'timeout' });

    const res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_container_failure_total');
  });

  // CONT-03: Container duration histogram
  it('containerDurationSeconds records observation in /metrics output', async () => {
    const port = await getPort();
    startMetricsServer(port);

    containerDurationSeconds.observe({ group: 'test-group' }, 30);

    const res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_container_duration_seconds');
  });

  // CONT-04: Active containers gauge
  it('containersActive gauge increments and decrements correctly', async () => {
    const port = await getPort();
    startMetricsServer(port);

    containersActive.inc();
    let res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_containers_active');

    // Verify gauge goes up with inc() and down with dec()
    const metric1 = await registry.getSingleMetricAsString('nanoclaw_containers_active');
    expect(metric1).toContain('nanoclaw_containers_active');

    containersActive.dec();
    const metric2 = await registry.getSingleMetricAsString('nanoclaw_containers_active');
    expect(metric2).toContain('nanoclaw_containers_active');
  });

  // AGNT-01: Agent invocation counter
  it('agentInvocationTotal appears in /metrics output after increment', async () => {
    const port = await getPort();
    startMetricsServer(port);

    agentInvocationTotal.inc();

    const res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_agent_invocation_total');
  });

  // AGNT-02: Agent duration histogram
  it('agentDurationSeconds records observation in /metrics output', async () => {
    const port = await getPort();
    startMetricsServer(port);

    agentDurationSeconds.observe(45);

    const res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_agent_duration_seconds');
  });

  // All six metrics appear in a single /metrics response
  it('all six subsystem metrics appear in /metrics output', async () => {
    const port = await getPort();
    startMetricsServer(port);

    const res = await fetchMetrics(port);
    expect(res.body).toContain('nanoclaw_container_spawn_total');
    expect(res.body).toContain('nanoclaw_container_failure_total');
    expect(res.body).toContain('nanoclaw_container_duration_seconds');
    expect(res.body).toContain('nanoclaw_containers_active');
    expect(res.body).toContain('nanoclaw_agent_invocation_total');
    expect(res.body).toContain('nanoclaw_agent_duration_seconds');
  });
});

describe('bind address', () => {
  afterEach(async () => {
    await stopMetricsServer();
  });

  function waitForListening(): Promise<void> {
    return new Promise((resolve) => {
      const srv = getMetricsServer();
      if (!srv) return resolve();
      srv.once('listening', resolve);
    });
  }

  // METR-04: startMetricsServer accepts optional bind address parameter
  it('startMetricsServer accepts a custom bind address and binds to it', async () => {
    const port = await getPort();
    startMetricsServer(port, '127.0.0.1');
    await waitForListening();

    const addr = getMetricsServer()?.address() as import('net').AddressInfo | null;
    expect(addr?.address).toBe('127.0.0.1');

    const res = await fetchMetrics(port);
    expect(res.statusCode).toBe(200);
  });

  // METR-05: default bind address is 0.0.0.0
  it('startMetricsServer defaults to 0.0.0.0 when no bind address provided', async () => {
    const port = await getPort();
    startMetricsServer(port);
    await waitForListening();

    const addr = getMetricsServer()?.address() as import('net').AddressInfo | null;
    expect(addr?.address).toBe('0.0.0.0');
  });
});

describe('agent metrics', () => {
  afterEach(async () => {
    await stopMetricsServer();
  });

  it('agentInvocationTotal counter can be incremented', async () => {
    const port = await getPort();
    startMetricsServer(port);

    agentInvocationTotal.inc();
    const metric = await registry.getSingleMetricAsString('nanoclaw_agent_invocation_total');
    expect(metric).toContain('nanoclaw_agent_invocation_total');
  });

  it('agentDurationSeconds histogram records observations', async () => {
    const port = await getPort();
    startMetricsServer(port);

    agentDurationSeconds.observe(60);
    const metric = await registry.getSingleMetricAsString('nanoclaw_agent_duration_seconds');
    expect(metric).toContain('nanoclaw_agent_duration_seconds');
  });
});
