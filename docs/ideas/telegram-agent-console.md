# Telegram Agent Console (working name)

## Problem Statement
How might I talk to my Telegram-only agent from inside VSCode, so I stop
alt-tabbing every time it pings me?

## Context
- Audience: me. Personal flow tool, not a product.
- Pain: my agent runs on my PC and uses a Telegram bot as its only I/O.
  When I am at the PC, opening Telegram (phone or desktop) to talk to my
  own agent feels silly. I want to read and reply from VSCode.
- Constraint: agent must remain Telegram-only on the input side. No
  localhost backdoor into the agent.
- Bot ownership: I own the bot (have the bot token via @BotFather).

## Recommended Direction
A single-purpose VSCode webview panel that mirrors ONE Telegram chat:
the conversation with my agent's bot. Built on gramjs (MTProto) alone,
authenticated as my user account. One protocol, one auth, both
directions. The extension subscribes to updates filtered to that bot's
chat_id, renders the conversation in a chat-style webview, and sends my
replies via the same MTProto session. Slash commands the bot has
registered are surfaced as typeahead when I type "/".

Key design decision: do not bring "Telegram" into VSCode. Bring THIS ONE
CHAT into VSCode. No chat list, no contacts, no media gallery, no
settings beyond auth. It is the chat panel for one bot. Everything off
that path is scope I am explicitly cutting.

Why MTProto-only and not Bot API + MTProto hybrid: from the user
account's perspective, MTProto already sees both sides of the chat (my
sends and the bot's replies). Adding Bot API would mean two protocols,
two auths, more code, no benefit.

## Key Assumptions to Validate
- [ ] MTProto session works inside a VSCode extension host.
      Spike: get gramjs login flow running end-to-end (phone -> code ->
      optional 2FA -> persisted session in SecretStorage). 2-3 hours.
      This is the riskiest assumption. If gramjs fights the extension
      sandbox, the whole design changes.
- [ ] Updates push reliably to the panel while VSCode is open.
      Spike: send a message from phone, confirm it appears in VSCode in
      under 2s. Handle reconnect on network blips and VSCode suspend.
- [ ] Bot's slash commands are fetchable from MTProto via
      messages.GetBotCommands. Fallback: Bot API getMyCommands (I have
      the token).
- [ ] One chat is genuinely enough. If a second bot appears later,
      generalize then, not now.

## MVP Scope

In:
- One-time auth (phone number, login code, optional 2FA password)
  persisted to VSCode SecretStorage.
- Sidebar webview panel: scrollable bubble list, timestamps,
  incoming/outgoing distinction.
- Reply input at the bottom; Enter to send, Shift+Enter for newline.
- Live updates pushed from MTProto into the webview.
- Bot username or chat_id read from settings (no in-app picker UI).
- Slash-command typeahead populated from the bot's registered commands.
- Unread badge on the VSCode activity bar icon.

Out (v1):
- Media (images, files, voice, stickers) -> rendered as placeholder
  text like "[image]" or "[voice 0:12]".
- Inline keyboards / reply markup -> plain text only.
- Markdown / entities / link previews -> plain text only.
- Multiple chats, search, chat list, contact picker.

## Not Doing (and Why)
- Media rendering -- Telegram media handling is its own swamp (download
  keys, thumbnails, voice waveforms). It is not the alt-tab pain.
  Revisit only if it actually bites in daily use.
- Multi-chat support -- explicit personal requirement: one bot only.
  Generalizing now would warp the architecture and the UI.
- Bot API path -- forces two protocols. MTProto alone covers both
  directions. Less code, one auth.
- Inline keyboard UI -- fancy, but plain text covers the goal of "stop
  alt-tabbing". Iterate if a specific bot interaction needs it.
- Typing indicators / read receipts -- do not reduce alt-tabbing.
- Localhost bypass into the agent -- ruled out by the strict-Telegram
  constraint.

## Open Questions
- Panel location: sidebar (always visible) vs. editor tab (toggleable)?
- OS notification on new message when the panel is unfocused? Probably
  yes -- that is the actual alt-tab killer.
- Render fenced code blocks with syntax highlighting? The one
  "code-aware" feature that arguably earns its cost for an agent chat.
- Session security: SecretStorage is OS-encrypted (DPAPI on Windows),
  but the MTProto session grants full Telegram account access if
  exfiltrated. Acceptable for personal use; worth being aware.

## Tech Stack (tentative)
- Language: TypeScript
- Extension framework: VSCode Extension API
- Telegram client: gramjs (MTProto)
- Storage: VSCode SecretStorage (session) + globalState (preferences)
- UI: webview panel, vanilla HTML/CSS/TS or a tiny framework (preact)
- Build: esbuild or rollup

## Decision Log
- 2026-05-11: Locked scope to single-bot chat panel. Rejected: generic
  Telegram client, Bot API-only path, localhost agent bypass.
- 2026-05-11: Chose MTProto-only over Bot API + MTProto hybrid for
  simplicity (one protocol, one auth, both directions visible).
