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
