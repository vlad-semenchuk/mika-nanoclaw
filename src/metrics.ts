import http from 'http';

import { Registry, collectDefaultMetrics } from 'prom-client';

// Singleton registry — import this everywhere metrics are defined.
// Never use prom-client's global `register`; always use this custom instance.
export const registry = new Registry();

// Collect default Node.js/process metrics once at module scope.
collectDefaultMetrics({ register: registry });

let server: http.Server | null = null;

/**
 * Start the Prometheus metrics HTTP server on the given port.
 * Binds to 127.0.0.1 only (not exposed externally).
 * Serves GET /metrics → 200 with Prometheus text format.
 * All other paths → 404.
 */
export function startMetricsServer(port: number): void {
  server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      try {
        const body = await registry.metrics();
        res.writeHead(200, { 'Content-Type': registry.contentType });
        res.end(body);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, '127.0.0.1');
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
