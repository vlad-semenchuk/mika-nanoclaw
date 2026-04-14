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

  private processedIds = new Set<string>();
  private consecutiveErrors = 0;
  private lastPollTime: string | null = null;

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

  private findMainJid(): string | null {
    const groups = this.opts.registeredGroups();
    for (const [jid, group] of Object.entries(groups)) {
      if (group.isMain) return jid;
    }
    return null;
  }

  private processRecords(
    type: string,
    records: any[],
    getId: (r: any) => string,
  ): void {
    const mainJid = this.findMainJid();
    if (!mainJid) return;

    for (const record of records) {
      if (record.score_state !== 'SCORED') continue;

      const id = getId(record);
      const key = `whoop:${type}:${id}`;
      if (this.processedIds.has(key)) continue;

      let content: string;
      switch (type) {
        case 'recovery':
          content = this.formatRecovery(record);
          break;
        case 'sleep':
          content = this.formatSleep(record);
          break;
        case 'cycle':
          content = this.formatCycle(record);
          break;
        case 'workout':
          content = this.formatWorkout(record);
          break;
        default:
          content = `[WHOOP] ${type}: ${JSON.stringify(record)}`;
      }

      this.opts.onMessage(mainJid, {
        id: key,
        chat_jid: mainJid,
        sender: 'whoop',
        sender_name: 'WHOOP',
        content,
        timestamp: record.updated_at,
        is_from_me: false,
      });

      logger.info({ type, id, mainJid }, 'WHOOP record delivered');

      this.processedIds.add(key);
      if (this.processedIds.size > 5000) {
        const entries = Array.from(this.processedIds);
        this.processedIds = new Set(entries.slice(entries.length - 2500));
      }
    }
  }

  private async pollForEvents(): Promise<void> {
    const params: Record<string, string> = { limit: '25' };
    if (this.lastPollTime) {
      params.start = this.lastPollTime;
    }

    try {
      const [recovery, sleep, cycle, workout] = await Promise.all([
        this.apiFetch<{ records: any[] }>('/v2/recovery', params),
        this.apiFetch<{ records: any[] }>('/v2/activity/sleep', params),
        this.apiFetch<{ records: any[] }>('/v2/cycle', params),
        this.apiFetch<{ records: any[] }>('/v2/activity/workout', params),
      ]);

      this.processRecords('recovery', recovery.records ?? [], (r) =>
        r.cycle_id.toString(),
      );
      this.processRecords('sleep', sleep.records ?? [], (r) => r.id);
      this.processRecords('cycle', cycle.records ?? [], (r) => r.id.toString());
      this.processRecords('workout', workout.records ?? [], (r) => r.id);

      this.lastPollTime = new Date().toISOString();
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      const backoffMin = Math.min(
        this.config.pollIntervalMs * Math.pow(2, this.consecutiveErrors),
        30 * 60 * 1000,
      );
      logger.warn(
        {
          err,
          consecutiveErrors: this.consecutiveErrors,
          backoffMs: backoffMin,
        },
        'WHOOP poll error',
      );
      throw err;
    }
  }

  async connect(): Promise<void> {
    if (!this.loadCredentials()) {
      logger.warn(
        'WHOOP credentials not found. Skipping WHOOP channel. Run /add-whoop to set up.',
      );
      return;
    }

    await this.apiFetch('/v2/user/profile/basic');
    this.connected = true;
    logger.info('WHOOP channel connected');

    const schedulePoll = () => {
      const backoffMs =
        this.consecutiveErrors > 0
          ? Math.min(
              this.config.pollIntervalMs * Math.pow(2, this.consecutiveErrors),
              30 * 60 * 1000,
            )
          : this.config.pollIntervalMs;
      this.pollTimer = setTimeout(() => {
        this.pollForEvents()
          .catch((err) => logger.error({ err }, 'WHOOP poll error'))
          .finally(() => {
            if (this.connected) schedulePoll();
          });
      }, backoffMs);
    };

    await this.pollForEvents();
    schedulePoll();
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

registerChannel('whoop', (opts: ChannelOpts) => {
  const credDir = path.join(os.homedir(), '.whoop');
  if (
    !fs.existsSync(path.join(credDir, 'credentials.json')) ||
    !fs.existsSync(path.join(credDir, 'token.json'))
  ) {
    logger.warn('WHOOP: credentials not found in ~/.whoop/');
    return null;
  }
  return new WhoopChannel(opts);
});
