import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../src/channels/registry.js', () => ({
  registerChannel: vi.fn(),
}));

import { WhoopChannel, WhoopChannelOpts } from '../../src/channels/whoop.js';

function makeOpts(overrides?: Partial<WhoopChannelOpts>): WhoopChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
    ...overrides,
  };
}

describe('WhoopChannel', () => {
  let channel: WhoopChannel;

  beforeEach(() => {
    channel = new WhoopChannel(makeOpts());
  });

  describe('name', () => {
    it('is whoop', () => {
      expect(channel.name).toBe('whoop');
    });
  });

  describe('ownsJid', () => {
    it('always returns false', () => {
      expect(channel.ownsJid('whoop:123')).toBe(false);
      expect(channel.ownsJid('tg:123')).toBe(false);
      expect(channel.ownsJid('gmail:abc')).toBe(false);
      expect(channel.ownsJid('12345@g.us')).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('is a no-op', async () => {
      await expect(channel.sendMessage('tg:123', 'hello')).resolves.toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('sets connected to false', async () => {
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });
  });
});

function setupCredFiles(dir: string, creds: object, tokens: object) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify(creds));
  fs.writeFileSync(path.join(dir, 'token.json'), JSON.stringify(tokens));
}

describe('WhoopChannel token management', () => {
  const tmpDir = path.join(os.tmpdir(), `whoop-test-${Date.now()}`);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadCredentials reads client_id and client_secret', () => {
    setupCredFiles(tmpDir, { client_id: 'cid', client_secret: 'csec' }, {
      access_token: 'at', refresh_token: 'rt', expires_at: '2099-01-01T00:00:00.000Z',
    });
    const channel = new WhoopChannel(makeOpts(), { credDir: tmpDir });
    const loaded = (channel as any).loadCredentials();
    expect(loaded).toBe(true);
    expect((channel as any).accessToken).toBe('at');
    expect((channel as any).clientId).toBe('cid');
  });

  it('loadCredentials returns false if files missing', () => {
    const channel = new WhoopChannel(makeOpts(), { credDir: '/nonexistent/path' });
    const loaded = (channel as any).loadCredentials();
    expect(loaded).toBe(false);
  });

  it('needsRefresh returns true when token expires within 5 minutes', () => {
    setupCredFiles(tmpDir, { client_id: 'cid', client_secret: 'csec' }, {
      access_token: 'at', refresh_token: 'rt',
      expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
    const channel = new WhoopChannel(makeOpts(), { credDir: tmpDir });
    (channel as any).loadCredentials();
    expect((channel as any).needsRefresh()).toBe(true);
  });

  it('needsRefresh returns false when token is fresh', () => {
    setupCredFiles(tmpDir, { client_id: 'cid', client_secret: 'csec' }, {
      access_token: 'at', refresh_token: 'rt',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    const channel = new WhoopChannel(makeOpts(), { credDir: tmpDir });
    (channel as any).loadCredentials();
    expect((channel as any).needsRefresh()).toBe(false);
  });
});

describe('formatRecovery', () => {
  it('formats a scored recovery into readable message', () => {
    const recovery = {
      cycle_id: 123,
      sleep_id: 'abc-uuid',
      score_state: 'SCORED',
      score: {
        recovery_score: 52,
        resting_heart_rate: 54,
        hrv_rmssd_milli: 97.96,
        spo2_percentage: 95.4,
        skin_temp_celsius: 33.2,
      },
    };
    const channel = new WhoopChannel(makeOpts());
    const msg = (channel as any).formatRecovery(recovery);
    expect(msg).toContain('[WHOOP Recovery]');
    expect(msg).toContain('Score: 52%');
    expect(msg).toContain('HRV: 98.0ms');
    expect(msg).toContain('RHR: 54bpm');
    expect(msg).toContain('SPO2: 95.4%');
  });
});

describe('formatSleep', () => {
  it('formats a scored sleep into readable message', () => {
    const sleep = {
      id: 'sleep-uuid',
      score_state: 'SCORED',
      nap: false,
      score: {
        stage_summary: {
          total_in_bed_time_milli: 28800000,
          total_rem_sleep_time_milli: 5400000,
          total_slow_wave_sleep_time_milli: 7200000,
        },
        respiratory_rate: 15.5,
        sleep_performance_percentage: 92,
        sleep_efficiency_percentage: 88.5,
      },
    };
    const channel = new WhoopChannel(makeOpts());
    const msg = (channel as any).formatSleep(sleep);
    expect(msg).toContain('[WHOOP Sleep]');
    expect(msg).toContain('Performance: 92%');
    expect(msg).toContain('Duration: 8h 0m');
    expect(msg).toContain('Efficiency: 88.5%');
    expect(msg).toContain('REM: 1h 30m');
    expect(msg).toContain('Deep: 2h 0m');
  });
});

describe('formatWorkout', () => {
  it('formats a scored workout into readable message', () => {
    const workout = {
      id: 'workout-uuid',
      sport_name: 'running',
      score_state: 'SCORED',
      start: '2026-04-11T13:00:00Z',
      end: '2026-04-11T13:45:00Z',
      score: {
        strain: 8.25,
        average_heart_rate: 123,
        max_heart_rate: 146,
        kilojoule: 1569.3,
        distance_meter: 5200,
      },
    };
    const channel = new WhoopChannel(makeOpts());
    const msg = (channel as any).formatWorkout(workout);
    expect(msg).toContain('[WHOOP Workout]');
    expect(msg).toContain('running');
    expect(msg).toContain('Strain: 8.3');
    expect(msg).toContain('Avg HR: 123bpm');
    expect(msg).toContain('5.2km');
  });
});

describe('formatCycle', () => {
  it('formats a scored cycle into readable message', () => {
    const cycle = {
      id: 123,
      score_state: 'SCORED',
      score: { strain: 5.3, kilojoule: 8288, average_heart_rate: 68, max_heart_rate: 141 },
    };
    const channel = new WhoopChannel(makeOpts());
    const msg = (channel as any).formatCycle(cycle);
    expect(msg).toContain('[WHOOP Cycle]');
    expect(msg).toContain('Strain: 5.3');
    expect(msg).toContain('Avg HR: 68bpm');
    expect(msg).toContain('1980kcal');
  });
});
