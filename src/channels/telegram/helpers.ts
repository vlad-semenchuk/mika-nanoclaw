import fs from 'fs';
import path from 'path';

import type { Api } from 'grammy';

import { GROUPS_DIR } from '../../config.js';
import type { ForwardableMessage, MediaTypeConfig } from './types.js';

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
      getFilenameOverride: (msg) => msg.document?.file_name || undefined,
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
    // eslint-disable-next-line no-catch-all/no-catch-all
  } catch {
    return null;
  }
}
