/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Containers are given ANTHROPIC_API_KEY=placeholder so the
 *             CLI skips the OAuth exchange entirely. The proxy strips the
 *             placeholder x-api-key and injects a real OAuth Bearer token
 *             (read fresh from ~/.claude/.credentials.json) on every request.
 *             This avoids the create_api_key exchange which requires a scope
 *             that gets lost on token refresh.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import { execFileSync } from 'child_process';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

type AuthMode = 'api-key' | 'oauth';

const CRED_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const TOKEN_TTL_MS = 10_000;

let lastGoodToken: string | undefined;
let lastTokenExpiresAt: number | undefined;
let lastTokenReadAt = 0;

/** @internal Reset cached token state (for tests). */
export function _resetTokenCache(): void {
  lastGoodToken = undefined;
  lastTokenExpiresAt = undefined;
  lastTokenReadAt = 0;
}

function readCredsJson(raw: string): { token?: string; expiresAt?: number } {
  try {
    const creds = JSON.parse(raw);
    return {
      token: creds?.claudeAiOauth?.accessToken,
      expiresAt: creds?.claudeAiOauth?.expiresAt,
    };
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    logger.debug({ err: err.message }, 'Failed to parse credentials JSON');
    return {};
  }
}

function readKeychainCredentials(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 3000, encoding: 'utf-8' },
    ).trim();
    return raw || undefined;
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    logger.debug({ err: err.message }, 'Keychain credentials not available');
    return undefined;
  }
}

function applyToken(token: string, expiresAt: number | undefined, source: string): string {
  if (token !== lastGoodToken) {
    logger.info(
      {
        tokenPrefix: token.slice(0, 25),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : 'unknown',
        expired: expiresAt ? Date.now() > expiresAt : 'unknown',
      },
      `OAuth token loaded from ${source}`,
    );
  }
  lastGoodToken = token;
  lastTokenExpiresAt = expiresAt;
  lastTokenReadAt = Date.now();
  return token;
}

function readOAuthToken(envFallback?: string, forceRefresh = false): string | undefined {
  if (!forceRefresh && lastGoodToken && Date.now() - lastTokenReadAt < TOKEN_TTL_MS) {
    return lastGoodToken;
  }

  // 1. Try credentials file (Linux / VPS)
  try {
    const raw = fs.readFileSync(CRED_PATH, 'utf-8');
    const { token, expiresAt } = readCredsJson(raw);
    if (token) return applyToken(token, expiresAt, 'credentials file');
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    logger.debug({ err: err.message }, 'Credentials file not found, trying next source');
  }

  // 2. Try macOS keychain
  const keychainRaw = readKeychainCredentials();
  if (keychainRaw) {
    const { token, expiresAt } = readCredsJson(keychainRaw);
    if (token) return applyToken(token, expiresAt, 'macOS keychain');
  }

  // 3. Cached token from a previous read
  if (lastGoodToken) return lastGoodToken;

  // 4. .env fallback
  if (envFallback) {
    logger.debug('Using .env fallback token');
  }
  return envFallback;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const envOauthFallback =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  const MAX_AUTH_RETRIES = 2;
  const AUTH_RETRY_DELAY_MS = 1000;

  function buildHeaders(
    incomingHeaders: Record<string, string>,
    bodyLength: number,
    forceTokenRefresh = false,
  ): Record<string, string | number | string[] | undefined> {
    const headers: Record<string, string | number | string[] | undefined> = {
      ...incomingHeaders,
      host: upstreamUrl.host,
      'content-length': bodyLength,
    };
    delete headers['connection'];
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];

    if (authMode === 'api-key') {
      headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
    } else if (headers['authorization']) {
      const currentToken = readOAuthToken(envOauthFallback, forceTokenRefresh);
      if (currentToken) {
        headers['authorization'] = `Bearer ${currentToken}`;
      }
    }
    return headers;
  }

  function drainBody(upRes: import('http').IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve) => {
      upRes.on('data', (c: Buffer) => chunks.push(c));
      upRes.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  function tokenHint(
    headers: Record<string, string | number | string[] | undefined>,
  ): string {
    const raw = (headers['authorization'] ?? headers['x-api-key'] ?? '') as string;
    return String(raw).slice(0, 35) || 'none';
  }

  function sendUpstream(
    reqMethod: string,
    reqUrl: string,
    origHeaders: Record<string, string>,
    body: Buffer,
    res: import('http').ServerResponse,
    attempt: number,
  ): void {
    const headers = buildHeaders(origHeaders, body.length, attempt > 0);
    const upstream = makeRequest(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttps ? 443 : 80),
        path: reqUrl,
        method: reqMethod,
        headers,
      } as RequestOptions,
      (upRes) => {
        if (upRes.statusCode === 401 && attempt < MAX_AUTH_RETRIES) {
          drainBody(upRes).then((errBuf) => {
            logger.warn(
              {
                status: 401,
                attempt,
                method: reqMethod,
                path: reqUrl,
                tokenPrefix: tokenHint(headers),
                tokenExpired: lastTokenExpiresAt ? Date.now() > lastTokenExpiresAt : 'unknown',
                body: errBuf.toString('utf-8').slice(0, 500),
              },
              'Proxy got 401, retrying with fresh token',
            );
            setTimeout(() => {
              sendUpstream(reqMethod, reqUrl, origHeaders, body, res, attempt + 1);
            }, AUTH_RETRY_DELAY_MS);
          });
          return;
        }

        if (upRes.statusCode && upRes.statusCode >= 400) {
          drainBody(upRes).then((errBuf) => {
            logger.warn(
              {
                status: upRes.statusCode,
                attempt,
                method: reqMethod,
                path: reqUrl,
                tokenPrefix: tokenHint(headers),
                tokenExpired: lastTokenExpiresAt ? Date.now() > lastTokenExpiresAt : 'unknown',
                body: errBuf.toString('utf-8').slice(0, 500),
              },
              'Proxy upstream error response',
            );
            res.writeHead(upRes.statusCode!, upRes.headers);
            res.end(errBuf);
          });
        } else {
          res.writeHead(upRes.statusCode!, upRes.headers);
          upRes.pipe(res);
        }
      },
    );

    upstream.on('error', (err) => {
      logger.error({ err, url: reqUrl }, 'Credential proxy upstream error');
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
    });

    upstream.write(body);
    upstream.end();
  }

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        sendUpstream(
          req.method || 'GET',
          req.url || '/',
          req.headers as Record<string, string>,
          body,
          res,
          0,
        );
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

