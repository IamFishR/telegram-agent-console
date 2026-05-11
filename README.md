# Telegram Agent Console

A focused VSCode side panel for chatting with **ONE Telegram bot** - typically
the bot wired up to your own agent on your machine. Stop alt-tabbing to your
phone every time the agent pings you.

**Scope is intentionally tiny:** one bot chat, full read + reply, slash command
typeahead. No chat list, no media, no contacts, no notifications when VSCode
is closed. If you want a full Telegram client, this is not it.

## What it looks like

After installing, you get a paper-plane icon in the Activity Bar. Click it,
follow the 3-step onboarding (api credentials, bot username, login with your
phone), and the panel mirrors your bot chat. Messages flow in real time;
replies send straight from the input box.

> **Screenshots:** add `media/screenshot-onboarding.png` and
> `media/screenshot-chat.png` to your project, reference them here, and they
> will render on the marketplace listing.

## Setup

You need three pieces before first use:

1. **Telegram `api_id` and `api_hash`.** Get them once from
   [my.telegram.org/apps](https://my.telegram.org/apps) (log in with your
   phone, create an application). These belong to you, not the bot.
2. **A Telegram bot you own.** Create one via
   [@BotFather](https://t.me/BotFather) with `/newbot`. Note the username
   (you do not need the bot token; this extension talks to the bot AS you,
   using your account).
3. **Your phone number.** Used once during login to receive a verification
   code from Telegram.

In the panel: click **Start Setup**, paste the three values, then click
**Login** and enter the code Telegram sends.

## Commands

| Command | What it does |
| --- | --- |
| `Telegram Agent: Setup` | Set api credentials and bot username |
| `Telegram Agent: Login` | Run the phone/code (+ optional 2FA) auth flow |
| `Telegram Agent: Logout` | Clear the saved session (keeps api credentials) |
| `Telegram Agent: Focus Chat Panel` | Reveal the panel |

## Settings

- `telegramAgentConsole.botUsername` - the bot to mirror (without `@`)
- `telegramAgentConsole.historyLimit` - messages loaded on open (default 50)
- `telegramAgentConsole.notifyOnIncoming` - OS notification on new message
  while the panel is unfocused (default `true`)

## Privacy and security

This is the most important section. Read it.

**What this extension does with your data:**

- Authenticates as **YOUR Telegram account** via MTProto (not as the bot).
  This is required to send messages AS you - the public Bot API cannot.
- Stores your `api_id`, `api_hash`, and **MTProto session string** in VSCode
  `SecretStorage`, which is OS-encrypted (DPAPI on Windows, Keychain on
  macOS, the keyring on Linux).
- Sends and receives messages directly to Telegram servers via gramjs. No
  third-party proxies, no analytics, no telemetry, no usage data.

**Trust requirements:**

- An MTProto session is equivalent in power to being logged into Telegram
  on a device. If exfiltrated, an attacker can read all your chats and
  send messages as you until the session is revoked. SecretStorage is
  OS-encrypted but not magic.
- `api_id`/`api_hash` are **your** credentials, supplied by you. This
  extension never bundles or hard-codes any. Some malicious extensions
  embed their developer's credentials and harvest user accounts; this one
  does not, by design.
- The extension is open source (MIT). Verify by reading the code in
  [src/telegramClient.ts](src/telegramClient.ts) - it is small.

**How to revoke access:**

- Run `Telegram Agent: Logout` from the command palette - clears the
  session locally.
- For belt-and-suspenders: open Telegram on your phone -> Settings ->
  Devices -> terminate the session named after your machine.

**Telemetry:** None. This extension makes network calls only to Telegram
servers via gramjs. It does not contact any author-controlled server.

## Limitations (intentional)

- **One chat only.** No chat list, no contacts, no multi-bot.
- **No media rendering.** Images, files, voice, and stickers appear as
  plain-text fallbacks (e.g. `[image]`). They still arrive on your phone.
- **No inline keyboards / reply markup.** Renders as plain text.
- **Markdown is partial.** Only inline code (`` `like this` ``) and fenced
  code blocks are rendered. Other Telegram entities render as plain text.
- **No typing indicators or read receipts.**
- **Background notifications stop when VSCode is closed.** The panel only
  listens while VSCode is running.

These are deliberate scope cuts to keep the extension small and focused. If
one of them genuinely bites in daily use, open an issue.

## Build from source

```bash
npm install
npm run build       # bundle with esbuild
npm run compile     # tsc typecheck (no emit)
npm run icon        # regenerate the marketplace icon
```

To run a dev host: open the folder in VSCode, press F5.

## Project layout

- `src/extension.ts` - activation, commands, wiring
- `src/telegramClient.ts` - gramjs wrapper (connect, login, send, listen)
- `src/chatPanel.ts` - WebviewView provider, host/webview message bus
- `src/credentials.ts` - SecretStorage wrapper
- `src/types.ts` - shared message types
- `media/webview.css`, `media/webview.js` - webview UI

The design rationale lives in
[docs/ideas/telegram-agent-console.md](docs/ideas/telegram-agent-console.md).

## License

[MIT](LICENSE) (c) 2026 IamFishR.
