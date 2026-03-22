import fs from 'fs';
import path from 'path';

import { Bot } from 'grammy';

import { ASSISTANT_NAME, GROUPS_DIR, TRIGGER_PATTERN } from '../config.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

/**
 * Extract the original sender name from a forwarded message, or undefined if
 * the message is not forwarded.  Supports both the modern `forward_origin`
 * (Bot API 7.0+) and the legacy `forward_from` / `forward_sender_name` fields.
 */
function getForwardedFrom(msg: any): string | undefined {
  // Modern field (Bot API ≥ 7.0)
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
  // Legacy fields
  if (msg.forward_from) {
    return msg.forward_from.first_name || msg.forward_from.username || 'Unknown user';
  }
  if (msg.forward_sender_name) {
    return msg.forward_sender_name;
  }
  return undefined;
}

/**
 * Download a file from Telegram and save to the group's media directory.
 * Returns the workspace path on success, null on failure.
 * Normalizes .oga -> .ogg (Whisper API doesn't accept .oga).
 */
async function downloadTelegramMedia(
  botToken: string,
  api: any,
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
    fs.mkdirSync(mediaDir, { recursive: true });

    let ext = path.extname(file.file_path) || defaultExt;
    if (ext === '.oga') ext = '.ogg';

    const filename = filenameOverride
      ? `${msgId}_${filenameOverride.replace(/[/\\:*?"<>|]/g, '_')}`
      : `${msgId}${ext}`;
    const localPath = path.join(mediaDir, filename);

    const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));

    return `/workspace/group/media/${filename}`;
  } catch {
    return null;
  }
}

/** Media type config for download-based handlers */
interface MediaTypeConfig {
  label: string;
  fallback: string;
  getFileId: (msg: any) => string | undefined;
  defaultExt: string;
  getFilenameOverride?: (msg: any) => string | undefined;
  supportsCaption?: boolean;
}

const MEDIA_TYPES: Record<string, MediaTypeConfig> = {
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
    getFilenameOverride: (msg) => msg.document?.file_name || undefined,
    supportsCaption: true,
  },
};

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

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.on('message:text', async (ctx) => {
      // Skip commands
      if (ctx.message.text.startsWith('/')) return;

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      // Mark forwarded messages so the agent knows the content isn't from the sender
      const forwardedFrom = getForwardedFrom(ctx.message);
      if (forwardedFrom) {
        content = `[Forwarded from ${forwardedFrom}] ${content}`;
      }

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
      // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
      // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
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

      // Store chat metadata for discovery
      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
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

    // Handle non-text messages with placeholders so the agent knows something was sent
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';
      const fwd = getForwardedFrom(ctx.message);
      const fwdPrefix = fwd ? `[Forwarded from ${fwd}] ` : '';

      this.opts.onChatMetadata(chatJid, timestamp);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${fwdPrefix}${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    // Register download-based media handlers
    for (const [filter, config] of Object.entries(MEDIA_TYPES)) {
      (this.bot as any).on(filter, async (ctx: any) => {
        const chatJid = `tg:${ctx.chat.id}`;
        const group = this.opts.registeredGroups()[chatJid];
        if (!group) return;

        const timestamp = new Date(ctx.message.date * 1000).toISOString();
        const senderName =
          ctx.from?.first_name ||
          ctx.from?.username ||
          ctx.from?.id?.toString() ||
          'Unknown';
        const caption = config.supportsCaption && ctx.message.caption
          ? ` ${ctx.message.caption}`
          : '';
        const msgId = ctx.message.message_id.toString();
        const fwd = getForwardedFrom(ctx.message);
        const fwdPrefix = fwd ? `[Forwarded from ${fwd}] ` : '';

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

    // Handle errors gracefully
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
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

    // Split on [STICKER:file_id] markers so stickers and text can be interleaved
    const parts = text.split(/(\[STICKER:[^\]]+\])/);

    for (const part of parts) {
      const stickerMatch = part.match(/^\[STICKER:([^\]]+)\]$/);
      if (stickerMatch) {
        try {
          await this.bot.api.sendSticker(numericId, stickerMatch[1]);
          logger.info({ jid }, 'Telegram sticker sent');
        } catch (err) {
          logger.error({ jid, err }, 'Failed to send Telegram sticker');
        }
        continue;
      }

      const trimmed = part.trim();
      if (!trimmed) continue;

      // Skip emoji-only segments — Telegram renders a lone emoji as a large
      // animated emoji sticker, which doubles up if sent alongside a real sticker.
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
      } catch (err) {
        logger.error({ jid, err }, 'Failed to send Telegram message');
      }
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    // Clear all typing intervals before stopping the bot
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

    // Always clear any existing interval for this jid
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
      } catch (err) {
        logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
      }
    };

    // Register the interval BEFORE any await to prevent a race where
    // setTyping(false) runs during the first sendTyping() and finds nothing to clear.
    const interval = setInterval(sendTyping, 4000);
    this.typingIntervals.set(jid, interval);

    // Safety net: auto-stop after TYPING_MAX_MS
    setTimeout(() => {
      if (this.typingIntervals.get(jid) === interval) {
        clearInterval(interval);
        this.typingIntervals.delete(jid);
        logger.debug({ jid }, 'Typing indicator auto-stopped after max duration');
      }
    }, TelegramChannel.TYPING_MAX_MS);

    // Fire immediately
    sendTyping();
  }
}
