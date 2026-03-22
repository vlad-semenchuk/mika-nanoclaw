---
name: transcribe-media
description: Transcribe audio and video files to text using Whisper. Use when the user asks to transcribe a voice message, video note, or any media file.
allowed-tools: Bash(transcribe-media:*)
---

# Transcribe Media

Transcribe audio and video files to text using Whisper (Groq or OpenAI).

## Usage

```bash
transcribe-media /workspace/group/media/123.ogg
```

The transcript is printed to stdout.

## Supported Formats

ogg, mp3, mp4, webm, wav, m4a, flac

## When to Use

- A user sends a voice message and asks what it says
- A user sends a video note and wants a transcript
- Any media file that contains spoken audio needing transcription

## Error Handling

- If no API key is configured, the script exits with an error message
- If transcription fails (unsupported format, API error), it prints the error to stderr
- Telegram Bot API limits file downloads to 20 MB — larger files won't be saved to disk
