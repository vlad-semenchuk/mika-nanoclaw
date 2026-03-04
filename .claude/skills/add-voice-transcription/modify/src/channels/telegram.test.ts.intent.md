# Intent: src/channels/telegram.test.ts modifications

## What changed
Added voice message transcription test coverage for the Telegram channel.

## Key sections

### Mocks (top of file)
- Added: `mockTranscribeBuffer` via `vi.hoisted()` so it's available before module loading
- Added: `vi.mock('../transcription.js', ...)` to intercept transcription calls

### `describe('voice transcription')` block (new)
Added after the `photo download` section with 6 test cases:
1. Successful transcription → content is `[Voice: <text>]`
2. `transcribeBuffer` returns null → fallback `[Voice message]`
3. `getFile` returns no `file_path` → fallback without calling `transcribeBuffer`
4. `getFile` throws → fallback `[Voice message]`
5. `fetch` fails (network error) → fallback `[Voice message]`
6. Unregistered chat → `onMessage` not called

### Existing `non-text messages` test rename
- Renamed: `'stores voice message with placeholder'` →
  `'stores voice message with placeholder when no voice data'`
  (clarifies the test scenario: no `voice` object on message → immediate fallback)

## Invariants (must-keep)
- All existing tests remain unchanged and passing
- Grammy mock (MockBot class) unchanged
- fs mock unchanged
- createMediaCtx, createTextCtx, triggerMediaMessage helpers unchanged
