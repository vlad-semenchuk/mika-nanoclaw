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

  private formatMilliToHM(ms: number): string {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  private formatRecovery(r: any): string {
    const s = r.score;
    return (
      `[WHOOP Recovery] Score: ${s.recovery_score}%` +
      ` | HRV: ${s.hrv_rmssd_milli.toFixed(1)}ms` +
      ` | RHR: ${s.resting_heart_rate}bpm` +
      ` | SPO2: ${s.spo2_percentage}%` +
      ` | Skin Temp: ${s.skin_temp_celsius}°C`
    );
  }

  private formatSleep(s: any): string {
    const sc = s.score;
    const ss = sc.stage_summary;
    return (
      `[WHOOP Sleep] Performance: ${sc.sleep_performance_percentage}%` +
      ` | Duration: ${this.formatMilliToHM(ss.total_in_bed_time_milli)}` +
      ` | Efficiency: ${sc.sleep_efficiency_percentage}%` +
      ` | REM: ${this.formatMilliToHM(ss.total_rem_sleep_time_milli)}` +
      ` | Deep: ${this.formatMilliToHM(ss.total_slow_wave_sleep_time_milli)}` +
      ` | Respiratory Rate: ${sc.respiratory_rate}`
    );
  }

  private formatWorkout(w: any): string {
    const sc = w.score;
    const durationMs = new Date(w.end).getTime() - new Date(w.start).getTime();
    const distanceKm = (sc.distance_meter / 1000).toFixed(1);
    return (
      `[WHOOP Workout] ${w.sport_name}` +
      ` | Strain: ${sc.strain.toFixed(1)}` +
      ` | Avg HR: ${sc.average_heart_rate}bpm` +
      ` | Max HR: ${sc.max_heart_rate}bpm` +
      ` | Duration: ${this.formatMilliToHM(durationMs)}` +
      ` | Distance: ${distanceKm}km`
    );
  }

  private formatCycle(c: any): string {
    const sc = c.score;
    const kcal = Math.floor(sc.kilojoule / 4.184);
    return (
      `[WHOOP Cycle] Strain: ${sc.strain}` +
      ` | Calories: ${kcal}kcal` +
      ` | Avg HR: ${sc.average_heart_rate}bpm` +
      ` | Max HR: ${sc.max_heart_rate}bpm`
    );
  }

  private async apiFetch<T>(
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<T> {
    if (this.needsRefresh()) {
      await this.refreshAccessToken();
    }

    const url = new URL(WHOOP_BASE_URL + endpoint);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const doRequest = async (): Promise<Response> => {
      return fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    };

    let res = await doRequest();

    if (res.status === 401) {
      await this.refreshAccessToken();
      res = await doRequest();
    }

    if (res.status === 429) {
      logger.warn('WHOOP API rate limited (429)');
      throw new Error('WHOOP API rate limited');
    }

    if (!res.ok) {
      throw new Error(`WHOOP API error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
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
