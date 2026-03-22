# Transcribe-Media Skill + Media Download Refactor

## Problem

Media messages (voice, video, video notes, audio, documents) in Telegram are either auto-transcribed (voice) or stored as text placeholders with no file access. The agent cannot access the actual media files, and there is no on-demand transcription capability.

## Goals

1. Save all downloadable media to disk so the agent can access them
2. Provide an on-demand transcription skill the agent can use for any media type
3. Establish a pattern for forwarding environment variables to containers for future skills

## Design

### 1. Container Environment Forwarding

Add a `CONTAINER_ENV_FORWARD` whitelist to `src/config.ts`:

```ts
export const CONTAINER_ENV_FORWARD: string[] = [
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
];
```

In `src/container-runner.ts`, after existing `-e` flags in `buildContainerArgs`:

```ts
for (const name of CONTAINER_ENV_FORWARD) {
  if (process.env[name]) {
    args.push('-e', `${name}=${process.env[name]}`);
  }
}
```

These are third-party API keys (not the Anthropic key that controls the agent). The Anthropic key stays behind the credential proxy; these are intentionally passed directly because routing them through a proxy would require multi-upstream proxy support for minimal security benefit.

### 2. Media Download Refactor in Telegram

Extract a shared helper in `src/channels/telegram.ts` that handles downloading any media file:

- Gets the file_id from the message context
- Downloads from Telegram API (note: Bot API has a 20 MB file size limit; larger files fail gracefully and fall back to the placeholder)
- Saves to `groups/{name}/media/{msgId}{ext}`
- Normalizes `.oga` extension to `.ogg` (Whisper API does not accept `.oga`)
- Returns the workspace path `/workspace/group/media/{msgId}{ext}`

**Media types using the download helper:**

| Event | Label | File ID source | Fallback |
|-------|-------|---------------|----------|
| `message:photo` | Photo | `ctx.message.photo[-1].file_id` | `[Photo]` |
| `message:voice` | Voice | `ctx.message.voice.file_id` | `[Voice message]` |
| `message:video` | Video | `ctx.message.video.file_id` | `[Video]` |
| `message:video_note` | Video note | `ctx.message.video_note.file_id` | `[Video note]` |
| `message:audio` | Audio | `ctx.message.audio.file_id` | `[Audio]` |
| `message:document` | Document | `ctx.message.document.file_id` | `[Document]` |

`message:video_note` is a new handler (round video messages) — not present in the current codebase.

**Message format:** `[Label: /workspace/group/media/{msgId}{ext}]{caption}`

For documents, the original filename is preserved and sanitized (path separators and special characters removed): `{msgId}_{sanitizedName}`.

**Behavioral change:** Voice messages are no longer auto-transcribed. They are saved to disk like all other media. The agent transcribes on demand via the skill. This is intentional — aligns all media types to the same pattern and lets the agent decide when transcription is needed.

**Unchanged handlers** (stay on `storeNonText`): sticker, location, contact.

**Photo migration:** Photos move from `groups/{name}/images/` to `groups/{name}/media/`. Existing files in `images/` are left as-is (old conversation history paths become stale but this is acceptable — the images themselves are not deleted).

### 3. `transcribe-media` Container Script

A Node.js script installed at `/usr/local/bin/transcribe-media` in the container via the Dockerfile.

**Behavior:**
- Takes a file path as argument: `transcribe-media /path/to/file.ogg`
- Reads `GROQ_API_KEY` or `OPENAI_API_KEY` from environment (Groq preferred)
- Sends the file to the Whisper API for transcription
- Prints the transcript to stdout
- Prints errors to stderr with non-zero exit code

**Supported formats:** Any format Whisper accepts — ogg, mp3, mp4, webm, wav, m4a, flac, mpeg, mpga.

The `openai` npm package is NOT a dependency of agent-runner. The Dockerfile must install it separately for the transcription script (either a standalone `npm install openai` step or a dedicated `package.json` for the script).

### 4. `transcribe-media` Skill

New directory: `container/skills/transcribe-media/SKILL.md`

```yaml
---
name: transcribe-media
description: Transcribe audio and video files to text using Whisper. Use when the user asks to transcribe a voice message, video note, or any media file.
allowed-tools: Bash(transcribe-media:*)
---
```

The skill body documents usage and supported formats.

### 5. Cleanup

- Delete `src/transcription.ts` — transcription moves to the container script
- Remove `transcribeBuffer` import from `src/channels/telegram.ts`

## Files Touched

| File | Change |
|------|--------|
| `src/config.ts` | Add `CONTAINER_ENV_FORWARD` |
| `src/container-runner.ts` | Add env forwarding loop |
| `src/channels/telegram.ts` | Refactor all media handlers, extract download helper, add video_note |
| `src/channels/telegram.test.ts` | Update tests for new media handling |
| `container/Dockerfile` | Install `transcribe-media` script and `openai` package |
| `container/transcribe-media.mjs` | New transcription script |
| `container/skills/transcribe-media/SKILL.md` | New skill |
| `src/transcription.ts` | Delete |

## Out of Scope

- **Media cleanup/retention policy** — media files will accumulate over time. A cleanup mechanism is deferred to a future task.
- **Capabilities skill update** — `container/skills/capabilities/SKILL.md` currently only checks for `agent-browser`. Should be updated to discover `transcribe-media` but is a separate concern.

## Testing

- Unit tests for all media type handlers (download success, download failure fallback)
- Unit test for env forwarding in container runner
- Manual test: send voice/video/photo to Telegram bot, verify files saved to media dir
- Manual test: agent uses `transcribe-media` skill to transcribe a voice message
