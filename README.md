# Telegram Agent Console

A focused VSCode side panel for chatting with **ONE Telegram bot** -
typically the bot wired up to your own agent on your machine. Stop
alt-tabbing to your phone every time the agent pings you.

**Scope is intentionally tiny:** one bot chat, full read + reply, slash
command typeahead. No chat list, no media, no contacts, no notifications
when VSCode is closed. If you want a full Telegram client, this is not
it.

This is **not published to any marketplace.** Install from source (see
below). The trade-off is no auto-updates - you `git pull` and rebuild
when you want the latest.

## Install from source

You need Node.js 18+ and a recent VSCode (1.85 or newer).

```bash
git clone https://github.com/IamFishR/telegram-agent-console.git
cd telegram-agent-console
npm install
npm run build
```

Then load it into VSCode as a developer extension:

1. Open the cloned folder in VSCode.
2. Press **F5** (or use the "Run and Debug" panel -> "Run Extension").
3. A second VSCode window opens with the extension loaded. This is the
   "Extension Development Host."

That second window is where you actually use the extension. Keep the
first window open while you use it - closing the first window stops the
extension host.

If you want it to load every time VSCode opens (without F5), build a
`.vsix` and install it:

```bash
npx @vscode/vsce package
code --install-extension telegram-agent-console-0.1.0.vsix
```

(The `npx` call downloads `vsce` on demand; no global install needed.
Note: `vsce package` will warn about a missing `publisher` field - it is
intentional. Add `--no-yarn` if it asks.)

## First-time setup

Once the extension is loaded:

1. Click the **paper-plane icon** in the Activity Bar.
2. The onboarding view walks you through three steps:
   - Get a personal `api_id` and `api_hash` from
     [my.telegram.org/apps](https://my.telegram.org/apps).
   - Get your bot's username from
     [@BotFather](https://t.me/BotFather) (or use an existing bot).
   - Click **Start Setup**, paste the three values when prompted.
3. After Setup, click **Login** and enter your phone number, then the
   one-time code Telegram sends to your phone (and your 2FA password if
   you have one).

Session is saved in VSCode's `SecretStorage` (OS-encrypted). You only
do this once per machine.

## Daily use

- The chat panel mirrors your bot chat in real time.
- Type `Enter` to send (Shift+Enter for newline).
- Type `/` to see your bot's registered slash commands. Arrow keys +
  Tab to pick.
- When the panel is unfocused, an OS notification appears for new
  messages (toggle via `telegramAgentConsole.notifyOnIncoming`).

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
- `telegramAgentConsole.notifyOnIncoming` - OS notification on new
  message while the panel is unfocused (default `true`)

## Privacy and security

- Authenticates as **YOUR Telegram account** via MTProto (not as the
  bot). This is required to send messages AS you - the public Bot API
  cannot.
- Stores `api_id`, `api_hash`, and the **MTProto session string** in
  VSCode `SecretStorage`, OS-encrypted (DPAPI on Windows, Keychain on
  macOS, the keyring on Linux).
- Talks **only** to Telegram servers via gramjs. No third-party
  proxies, no analytics, no telemetry, no usage data.
- `api_id` / `api_hash` are **your** credentials, supplied by you. This
  extension never bundles or hard-codes any.

**To revoke access:** run `Telegram Agent: Logout` from the command
palette. Or remotely: Telegram app -> Settings -> Devices -> terminate
the session named after your machine.

An MTProto session is as powerful as being logged into Telegram on a
device. SecretStorage is OS-encrypted but not magic. Treat your machine
accordingly.

## Limitations (intentional)

- **One chat only.** No chat list, no contacts, no multi-bot.
- **No media rendering.** Images, files, voice, stickers appear as
  plain-text fallbacks. They still arrive on your phone.
- **No inline keyboards / reply markup.** Renders as plain text.
- **Markdown is partial.** Inline code and fenced code blocks render;
  other Telegram entities show as plain text.
- **No typing indicators or read receipts.**
- **Background notifications stop when VSCode is closed.** The panel
  only listens while VSCode is running.

These are deliberate scope cuts. If one of them genuinely bites in
daily use, open an issue.

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

[MIT](LICENSE).
