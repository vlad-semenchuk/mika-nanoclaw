import type { Message } from '@grammyjs/types';

import type { OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../../types.js';

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export interface ForwardableMessage {
  forward_origin?: Message.CommonMessage['forward_origin'];
  forward_from?: { first_name?: string; username?: string };
  forward_sender_name?: string;
}

export interface MediaTypeConfig {
  label: string;
  fallback: string;
  getFileId: (msg: Message) => string | undefined;
  defaultExt: string;
  getFilenameOverride?: (msg: Message) => string | undefined;
  supportsCaption?: boolean;
}
