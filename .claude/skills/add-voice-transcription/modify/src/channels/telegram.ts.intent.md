# Intent: src/channels/telegram.ts modifications

## What changed
Added voice message transcription support. When a Telegram voice note arrives, it is downloaded and transcribed via Groq/OpenAI Whisper before being stored as message content.

## Key sections

### Imports (top of file)
- Added: `transcribeBuffer` from `../transcription.js`

### message:voice handler
- Replaced: `storeNonText(ctx, '[Voice message]')` (synchronous placeholder)
- Added: async handler that downloads the voice file via Telegram file API
- Added: calls `transcribeBuffer(buffer, 'voice.ogg')` on the downloaded buffer
  - Success: `content = '[Voice: <transcript>]'`
  - Null result (no API key or transcription failed): `content = '[Voice message]'`
  - Error (download failure, API error): `content = '[Voice message]'`
- Added: `logger.info` with `transcribed: content.startsWith('[Voice:')` field

### message:audio handler
- Unchanged: still uses `storeNonText(ctx, '[Audio]')` — audio files are typically music, not voice notes

## Invariants (must-keep)
- All other message handlers (photo, video, audio, document, sticker, location, contact) unchanged
- Photo download logic unchanged
- sendMessage, setTyping, ownsJid, isConnected, disconnect — all unchanged
- Bot command handlers (chatid, ping) unchanged
- Error handler unchanged
- storeNonText helper unchanged
