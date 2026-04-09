import fs from 'fs/promises';
import path from 'path';

import { Bot, type Api, type Context, InputFile } from 'grammy';
import type { Message } from '@grammyjs/types';

import { ASSISTANT_NAME, GROUPS_DIR, TELEGRAM_BOT_TOKEN, TRIGGER_PATTERN } from '../config.js';
import { logger } from '../logger.js';
import { Channel, OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

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

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export const MEDIA_TYPES: Record<string, MediaTypeConfig> = {
    'message:photo': {
      label: 'Photo',
      fallback: '[Photo]',
      getFileId: (msg) => msg.photo?.[msg.photo.length - 1]?.file_id,
      defaultExt: '.jpg',
      supportsCaption: true,
    },
    'message:voice': {
      label: 'Voice',
      fallback: '[Voice message]',
      getFileId: (msg) => msg.voice?.file_id,
      defaultExt: '.ogg',
    },
    'message:video': {
      label: 'Video',
      fallback: '[Video]',
      getFileId: (msg) => msg.video?.file_id,
      defaultExt: '.mp4',
      supportsCaption: true,
    },
    'message:video_note': {
      label: 'Video note',
      fallback: '[Video note]',
      getFileId: (msg) => msg.video_note?.file_id,
      defaultExt: '.mp4',
    },
    'message:audio': {
      label: 'Audio',
      fallback: '[Audio]',
      getFileId: (msg) => msg.audio?.file_id,
      defaultExt: '.mp3',
      supportsCaption: true,
    },
    'message:document': {
      label: 'Document',
      fallback: '[Document]',
      getFileId: (msg) => msg.document?.file_id,
      defaultExt: '.bin',
      getFilenameOverride: (msg) => msg.document?.file_name,
      supportsCaption: true,
    },
  };

export function getSenderName(from?: { first_name?: string; username?: string; id?: number }): string {
  return from?.first_name || from?.username || from?.id?.toString() || 'Unknown';
}

export function getForwardedPrefix(msg: ForwardableMessage): string {
  const name = getForwardedFrom(msg);
  return name ? `[Forwarded from ${name}] ` : '';
}

export function getChatName(
  chat: { type: string; id: number; title?: string },
  senderName: string,
  chatJid: string,
): string {
  if (chat.type === 'private') return senderName;
  return chat.title || chatJid;
}

function getForwardedFrom(msg: ForwardableMessage): string | undefined {
  const origin = msg.forward_origin;
  if (origin) {
    switch (origin.type) {
      case 'user':
        return origin.sender_user?.first_name || origin.sender_user?.username || 'Unknown user';
      case 'hidden_user':
        return origin.sender_user_name || 'Hidden user';
      case 'chat':
        return origin.sender_chat?.title || 'Unknown chat';
      case 'channel':
        return origin.chat?.title || 'Unknown channel';
    }
  }
  if (msg.forward_from) {
    return msg.forward_from.first_name || msg.forward_from.username || 'Unknown user';
  }
  if (msg.forward_sender_name) {
    return msg.forward_sender_name;
  }
  return undefined;
}

export async function downloadTelegramMedia(
  botToken: string,
  api: Api,
  fileId: string,
  groupFolder: string,
  msgId: string,
  defaultExt: string,
  filenameOverride?: string,
): Promise<string | null> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return null;

    const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
    await fs.mkdir(mediaDir, { recursive: true });

    let ext = path.extname(file.file_path) || defaultExt;
    if (ext === '.oga') ext = '.ogg';

    const filename = filenameOverride
      ? `${msgId}_${filenameOverride.replace(/[/\\:*?"<>|]/g, '_')}`
      : `${msgId}${ext}`;
    const localPath = path.join(mediaDir, filename);

    const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await fs.writeFile(localPath, Buffer.from(await response.arrayBuffer()));

    return `/workspace/group/media/${filename}`;
    // eslint-disable-next-line no-catch-all/no-catch-all
  } catch {
    return null;
  }
}

registerChannel('telegram', (opts: ChannelOpts): Channel | null => {
  if (!TELEGRAM_BOT_TOKEN) return null;
  return new TelegramChannel(TELEGRAM_BOT_TOKEN, opts);
});

export class TelegramChannel implements Channel {
  name = 'telegram';

  private static readonly TYPING_MAX_MS = 120_000; // 2 minutes

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : ('title' in ctx.chat ? ctx.chat.title : undefined) || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.command('compact', (ctx) => {
      const msg = ctx.message ?? ctx.channelPost;
      if (!msg) return;
      const chatJid = `tg:${ctx.chat.id}`;
      const timestamp = new Date(msg.date * 1000).toISOString();
      const senderName = getSenderName(ctx.from);
      const chatName = getChatName(ctx.chat, senderName, chatJid);

      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      this.opts.onMessage(chatJid, {
        id: msg.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: '/compact',
        timestamp,
        is_from_me: false,
      });

      logger.info({ chatJid, chatName, sender: senderName }, 'Compacting...');
    });

    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName = getSenderName(ctx.from);
      const sender = ctx.from?.id?.toString() || '';
      const msgId = ctx.message.message_id.toString();

      const fwdPrefix = getForwardedPrefix(ctx.message);
      if (fwdPrefix) content = `${fwdPrefix}${content}`;

      const chatName = getChatName(ctx.chat, senderName, chatJid);

      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    const storeNonText = (ctx: Context & { chat: NonNullable<Context['chat']>; message: NonNullable<Context['message']> }, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName = getSenderName(ctx.from);
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      this.opts.onChatMetadata(chatJid, timestamp);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${getForwardedPrefix(ctx.message)}${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    for (const [filter, config] of Object.entries(MEDIA_TYPES)) {
      (this.bot as Bot).on(filter as 'message:photo', async (ctx) => {
        const chatJid = `tg:${ctx.chat.id}`;
        const group = this.opts.registeredGroups()[chatJid];
        if (!group) return;

        const timestamp = new Date(ctx.message.date * 1000).toISOString();
        const senderName = getSenderName(ctx.from);
        const caption = config.supportsCaption && ctx.message.caption
          ? ` ${ctx.message.caption}`
          : '';
        const msgId = ctx.message.message_id.toString();
        const fwdPrefix = getForwardedPrefix(ctx.message);

        const fileId = config.getFileId(ctx.message);
        let content: string;

        if (fileId) {
          const filenameOverride = config.getFilenameOverride?.(ctx.message);
          const workspacePath = await downloadTelegramMedia(
            this.botToken, ctx.api, fileId,
            group.folder, msgId, config.defaultExt, filenameOverride,
          );
          content = workspacePath
            ? `${fwdPrefix}[${config.label}: ${workspacePath}]${caption}`
            : `${fwdPrefix}${config.fallback}${caption}`;
        } else {
          content = `${fwdPrefix}${config.fallback}${caption}`;
        }

        this.opts.onChatMetadata(chatJid, timestamp);
        this.opts.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        logger.info(
          { chatJid, mediaType: config.label, downloaded: content.includes('/workspace/') },
          'Telegram media stored',
        );
      });
    }

    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    await this.bot.api.setMyCommands([
      { command: 'compact', description: 'Compact session context' },
      { command: 'ping', description: 'Check bot status' },
    ]);

    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    const numericId = jid.replace(/^tg:/, '');
    const MAX_LENGTH = 4096;

    const parts = text.split(/(\[STICKER:[^\]]+\]|\[(?:image|PHOTO|IMAGE|photo):[^\]]+\])/);

    for (const part of parts) {
      const stickerMatch = part.match(/^\[STICKER:([^\]]+)\]$/);
      if (stickerMatch) {
        try {
          await this.bot.api.sendSticker(numericId, stickerMatch[1]);
          logger.info({ jid }, 'Telegram sticker sent');
          // eslint-disable-next-line no-catch-all/no-catch-all
        } catch (err) {
          logger.error({ jid, err }, 'Failed to send Telegram sticker');
        }
        continue;
      }

      const imageMatch = part.match(/^\[(?:image|PHOTO|IMAGE|photo):([^\]]+)\]$/);
      if (imageMatch) {
        const hostPath = this.resolveWorkspacePath(jid, imageMatch[1]);
        if (hostPath) {
          try {
            await this.bot.api.sendPhoto(numericId, new InputFile(hostPath));
            logger.info({ jid, path: hostPath }, 'Telegram photo sent');
            // eslint-disable-next-line no-catch-all/no-catch-all
          } catch (err) {
            logger.error({ jid, path: hostPath, err }, 'Failed to send Telegram photo');
          }
        }
        continue;
      }

      const trimmed = part.trim();
      if (!trimmed) continue;

      // Telegram renders lone emojis as large animated stickers, doubling up with real stickers
      if (/^[\p{Extended_Pictographic}\u{FE0F}\u{20E3}\u{200D}\s]+$/u.test(trimmed)) continue;

      try {
        if (trimmed.length <= MAX_LENGTH) {
          await this.bot.api.sendMessage(numericId, trimmed);
        } else {
          for (let i = 0; i < trimmed.length; i += MAX_LENGTH) {
            await this.bot.api.sendMessage(
              numericId,
              trimmed.slice(i, i + MAX_LENGTH),
            );
          }
        }
        logger.info({ jid, length: trimmed.length }, 'Telegram message sent');
        // eslint-disable-next-line no-catch-all/no-catch-all
      } catch (err) {
        logger.error({ jid, err }, 'Failed to send Telegram message');
      }
    }
  }

  private resolveWorkspacePath(jid: string, workspacePath: string): string | null {
    const group = this.opts.registeredGroups()[jid];
    if (!group) return null;

    const groupMediaPrefix = '/workspace/group/';
    if (workspacePath.startsWith(groupMediaPrefix)) {
      const relativePath = workspacePath.slice(groupMediaPrefix.length);
      return path.join(GROUPS_DIR, group.folder, relativePath);
    }
    return null;
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    for (const [jid, interval] of this.typingIntervals) {
      clearInterval(interval);
      this.typingIntervals.delete(jid);
    }
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot) return;

    const existing = this.typingIntervals.get(jid);
    if (existing) {
      clearInterval(existing);
      this.typingIntervals.delete(jid);
    }

    if (!isTyping) return;

    const numericId = jid.replace(/^tg:/, '');
    const sendTyping = async () => {
      if (!this.bot) return;
      try {
        await this.bot.api.sendChatAction(numericId, 'typing');
        // eslint-disable-next-line no-catch-all/no-catch-all
      } catch (err) {
        logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
      }
    };

    // Register before awaiting sendTyping() to prevent a race with setTyping(false)
    const interval = setInterval(sendTyping, 4000);
    this.typingIntervals.set(jid, interval);

    setTimeout(() => {
      if (this.typingIntervals.get(jid) === interval) {
        clearInterval(interval);
        this.typingIntervals.delete(jid);
        logger.debug({ jid }, 'Typing indicator auto-stopped after max duration');
      }
    }, TelegramChannel.TYPING_MAX_MS);

    sendTyping();
  }
}
