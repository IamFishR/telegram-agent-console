# Changelog

All notable changes to this extension are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-05-11

Initial public release.

### Added
- Side-panel chat UI mirroring one Telegram bot conversation.
- MTProto-based connection via gramjs (authenticates as your Telegram
  account, not the bot - the only way to send messages AS you).
- Onboarding view with step-by-step setup for `api_id`, `api_hash`, and
  bot username.
- Slash-command typeahead populated from the bot's registered commands
  (arrow keys + Tab).
- Auto-resizing reply box; Enter to send, Shift+Enter for newline.
- Inline code (`` `like this` ``) and fenced code block rendering.
- Unread message OS notification when the panel is not focused.
- Persisted session via VSCode SecretStorage (OS-encrypted).
- Commands: Setup, Login, Logout, Focus Chat Panel.

### Out of scope (intentional)
- Media (images, files, voice, stickers) - rendered as plain-text fallback.
- Inline keyboards / reply markup - plain text only.
- Multiple chats, search, contact picker, chat list.
- Typing indicators and read receipts.
