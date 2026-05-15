# Telegram Agent Console

A focused VSCode side panel for chatting with **ONE Telegram bot** -
typically the bot wired up to your own agent on your machine. Stop
alt-tabbing to your phone every time the agent pings you.

**Scope is intentionally tiny:** one bot chat, full read + reply, slash
command typeahead. No chat list, no media, no contacts, no notifications
when VSCode is closed. If you want a full Telegram client, this is not
it.

Available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=IamFishR.telegram-agent-console).
Search **"Telegram Agent Console"** in the Extensions panel, or install via command line:

```bash
code --install-extension IamFishR.telegram-agent-console
```

## Install from source (build your own .vsix)

This is the path most people want: build a `.vsix` once, install it,
and it behaves like any marketplace extension - loads automatically on
every VSCode start, appears in the Extensions sidebar, uninstall like
anything else.

Prerequisites: Node.js 18+ and VSCode 1.85 or newer.

```bash
git clone https://github.com/IamFishR/telegram-agent-console.git
cd telegram-agent-console
npm install
npm run build
npx @vscode/vsce package
code --install-extension telegram-agent-console-0.1.0.vsix
```

That's it. Open VSCode (or reload the window) and the paper-plane icon
appears in the Activity Bar. `npx` downloads `vsce` on demand - no
global install needed.

**To update later:**

```bash
git pull
npm install
npm run build
npx @vscode/vsce package
code --install-extension telegram-agent-console-0.1.0.vsix --force
```

The `--force` flag overwrites the previously installed version.

**To uninstall:** Extensions sidebar -> find "Telegram Agent Console"
-> gear icon -> Uninstall. Or: `code --uninstall-extension IamFishR.telegram-agent-console`.

## Install (dev mode, for hacking on the code)

If you want to modify the extension and see changes live, skip the
`.vsix` step and run it as a developer extension instead:

```bash
git clone https://github.com/IamFishR/telegram-agent-console.git
cd telegram-agent-console
npm install
npm run build      # or: npm run watch
```

Then open the folder in VSCode and press **F5**. A second VSCode window
opens with the extension loaded ("Extension Development Host"). Use
the extension in that window; reload it with **Ctrl+R** after code
changes. Closing the first window stops the extension host.

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
