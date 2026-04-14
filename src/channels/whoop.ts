import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface WhoopChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class WhoopChannel implements Channel {
  name = 'whoop';

  private opts: WhoopChannelOpts;
  private connected = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: WhoopChannelOpts) {
    this.opts = opts;
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
