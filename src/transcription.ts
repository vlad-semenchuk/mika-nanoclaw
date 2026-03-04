import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'whisper-large-v3-turbo';
const OPENAI_MODEL = 'whisper-1';
const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

/**
 * Transcribe an audio buffer using Groq (preferred) or OpenAI Whisper.
 * Reads GROQ_API_KEY or OPENAI_API_KEY from .env — Groq takes precedence.
 * Returns the transcript string, or null if no API key is configured or
 * transcription fails.
 */
export async function transcribeBuffer(
  audioBuffer: Buffer,
  filename: string,
): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY', 'GROQ_API_KEY']);
  const groqKey = env.GROQ_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  const apiKey = groqKey || openaiKey;

  if (!apiKey) {
    console.warn('Neither GROQ_API_KEY nor OPENAI_API_KEY is set in .env');
    return null;
  }

  const baseURL = groqKey ? GROQ_BASE_URL : undefined;
  const model = groqKey ? GROQ_MODEL : OPENAI_MODEL;

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

    const file = await toFile(audioBuffer, filename, { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model,
      response_format: 'text',
    });

    // When response_format is 'text', the API returns a plain string
    return transcription as unknown as string;
  } catch (err) {
    console.error('Transcription failed:', err);
    return null;
  }
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.error('Failed to download audio message');
      return FALLBACK_MESSAGE;
    }

    console.log(`Downloaded audio message: ${buffer.length} bytes`);

    const transcript = await transcribeBuffer(buffer, 'voice.ogg');
    return transcript ? transcript.trim() : FALLBACK_MESSAGE;
  } catch (err) {
    console.error('Transcription error:', err);
    return FALLBACK_MESSAGE;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
