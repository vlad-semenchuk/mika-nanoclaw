---
name: add-voice-transcription
description: Add voice message transcription to NanoClaw using Groq or OpenAI's Whisper API. Automatically transcribes voice notes on WhatsApp and Telegram so the agent can read and respond to them.
---

# Add Voice Transcription

This skill adds automatic voice message transcription to NanoClaw's WhatsApp and Telegram channels. When a voice note arrives, it is downloaded, transcribed, and delivered to the agent as `[Voice: <transcript>]`.

Supported providers:
- **Groq** (recommended — free tier, fast): uses `whisper-large-v3-turbo`
- **OpenAI**: uses `whisper-1`

Groq is used automatically when `GROQ_API_KEY` is set; falls back to OpenAI if `OPENAI_API_KEY` is set instead.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `voice-transcription` is in `applied_skills`, skip to Phase 3 (Configure). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect the API provider and key:

Options:
- **Groq** (free tier): create a free key at https://console.groq.com/keys
- **OpenAI** (paid): create a key at https://platform.openai.com/api-keys

## Phase 2: Apply Code Changes

Run the skills engine to apply this skill's code package.

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-voice-transcription
```

This deterministically:
- Adds `src/transcription.ts` (channel-agnostic transcription module supporting Groq and OpenAI)
- Three-way merges voice handling into `src/channels/whatsapp.ts`
- Three-way merges voice handling into `src/channels/telegram.ts` (download + transcribe voice notes)
- Three-way merges transcription tests into `src/channels/whatsapp.test.ts`
- Three-way merges transcription tests into `src/channels/telegram.test.ts` (6 new test cases)
- Installs the `openai` npm dependency
- Updates `.env.example` with `GROQ_API_KEY` / `OPENAI_API_KEY`
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/channels/whatsapp.ts.intent.md` — what changed and invariants for whatsapp.ts
- `modify/src/channels/telegram.ts.intent.md` — what changed and invariants for telegram.ts
- `modify/src/channels/telegram.test.ts.intent.md` — what changed for telegram.test.ts

### Validate code changes

```bash
npm test
npm run build
```

All tests must pass (including the new voice transcription tests for both channels) and build must be clean before proceeding.

## Phase 3: Configure

### Get API key (if not already collected)

**Groq (recommended — free):**
1. Go to https://console.groq.com/keys
2. Click "Create API Key"
3. Copy the key (starts with `gsk_`)

**OpenAI (paid, ~$0.006/min):**
1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-`)

### Add to environment

Add to `.env`:

```bash
# Groq (recommended — free tier):
GROQ_API_KEY=gsk_...

# OR OpenAI:
# OPENAI_API_KEY=sk-...
```

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Verify

### Test with a voice note

Tell the user:

> Send a voice note in any registered WhatsApp or Telegram chat. The agent should receive it as `[Voice: <transcript>]` and respond to its content.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log | grep -i voice
```

Look for:
- `Transcribed voice message` (WhatsApp) / `Telegram voice message stored` with `transcribed: true` — success
- `Neither GROQ_API_KEY nor OPENAI_API_KEY is set` — key missing from `.env`
- `Transcription failed:` — API error (check key validity)
- `Failed to transcribe Telegram voice message` — download or transcription error

## Troubleshooting

### Voice notes show "[Voice Message - transcription unavailable]" (WhatsApp)

1. Check `GROQ_API_KEY` or `OPENAI_API_KEY` is set in `.env`
2. Verify Groq key works: `curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY" | head -c 200`

### Voice notes show "[Voice message]" (Telegram)

1. Check `GROQ_API_KEY` or `OPENAI_API_KEY` is set in `.env`
2. Check logs for specific error (download failure vs. transcription failure)

### Agent doesn't respond to voice notes

Verify the chat is registered and the agent is running. Voice transcription only runs for registered groups.
