import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const WHOOP_BASE_URL = 'https://api.prod.whoop.com/developer';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

export interface WhoopChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface WhoopConfig {
  credDir?: string;
  pollIntervalMs?: number;
}

export class WhoopChannel implements Channel {
  name = 'whoop';

  private opts: WhoopChannelOpts;
  private config: Required<WhoopConfig>;
  private connected = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  private clientId = '';
  private clientSecret = '';
  private accessToken = '';
  private refreshToken = '';
  private expiresAt = 0; // unix ms

  constructor(opts: WhoopChannelOpts, config?: WhoopConfig) {
    this.opts = opts;
    this.config = {
      credDir: config?.credDir ?? path.join(os.homedir(), '.whoop'),
      pollIntervalMs: config?.pollIntervalMs ?? 5 * 60 * 1000,
    };
  }

  private loadCredentials(): boolean {
    const credPath = path.join(this.config.credDir, 'credentials.json');
    const tokenPath = path.join(this.config.credDir, 'token.json');

    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

      this.clientId = creds.client_id ?? '';
      this.clientSecret = creds.client_secret ?? '';
      this.accessToken = tokens.access_token ?? '';
      this.refreshToken = tokens.refresh_token ?? '';
      this.expiresAt = tokens.expires_at
        ? new Date(tokens.expires_at).getTime()
        : 0;

      return true;
    } catch {
      return false;
    }
  }

  private needsRefresh(): boolean {
    return (
      this.expiresAt > 0 && Date.now() + REFRESH_BUFFER_MS >= this.expiresAt
    );
  }

  private async refreshAccessToken(): Promise<void> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    const tokenPath = path.join(this.config.credDir, 'token.json');
    fs.writeFileSync(
      tokenPath,
      JSON.stringify(
        {
          access_token: this.accessToken,
          refresh_token: this.refreshToken,
          expires_at: new Date(this.expiresAt).toISOString(),
        },
        null,
        2,
      ),
    );
  }

  async connect(): Promise<void> {
    // TODO: implemented in Task 3
  }

  async sendMessage(_jid: string, _text: string): Promise<void> {
    // No-op: WHOOP has no inbox
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(_jid: string): boolean {
    return false;
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
    logger.info('WHOOP channel stopped');
  }
}
