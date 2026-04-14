import { describe, it, expect, vi, beforeEach } from 'vitest';

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
