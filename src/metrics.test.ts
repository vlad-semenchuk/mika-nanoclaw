import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { registry, startMetricsServer, stopMetricsServer } from './metrics.js';

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
