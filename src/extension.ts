import * as vscode from 'vscode';
import { TgClient, AuthCallbacks } from './telegramClient';
import { Credentials } from './credentials';
import { ChatPanel } from './chatPanel';

let tg: TgClient | undefined;
let panel: ChatPanel;
let credentials: Credentials;
let output: vscode.OutputChannel;
let bootstrapping = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Telegram Agent Console');
  context.subscriptions.push(output);

  credentials = new Credentials(context.secrets);

  panel = new ChatPanel(context.extensionUri, {
    onReady: () => { void bootstrap(); },
    onSend: (tempId, text) => { void handleSend(tempId, text); },
    onLogin: () => { void doLogin(); },
    onSetup: () => { void doSetup(); },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, panel),
    vscode.commands.registerCommand('telegram-agent-console.setup', doSetup),
    vscode.commands.registerCommand('telegram-agent-console.login', doLogin),
    vscode.commands.registerCommand('telegram-agent-console.logout', doLogout),
    vscode.commands.registerCommand('telegram-agent-console.focus', () => panel.reveal()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('telegramAgentConsole.botUsername')) {
        void reconnect();
      }
    }),
  );
}

export async function deactivate(): Promise<void> {
  if (tg) {
    await tg.disconnect();
    tg = undefined;
  }
}

async function bootstrap(): Promise<void> {
  if (bootstrapping) return;
  bootstrapping = true;
  try {
    const apiId = await credentials.getApiId();
    const apiHash = await credentials.getApiHash();
    if (!apiId || !apiHash) {
      panel.post({ type: 'state', state: 'noCredentials' });
      return;
    }
    const botUsername = (vscode.workspace
      .getConfiguration('telegramAgentConsole')
      .get<string>('botUsername') ?? '').trim();
    if (!botUsername) {
      panel.post({ type: 'state', state: 'noBot' });
      return;
    }

    if (tg) {
      await tg.disconnect();
      tg = undefined;
    }

    panel.post({ type: 'state', state: 'connecting', detail: 'Connecting to Telegram' });

    const session = await credentials.getSession();
    tg = new TgClient(apiId, apiHash, session, (s) => output.appendLine(s));
    const authed = await tg.tryConnect();
    if (!authed) {
      panel.post({ type: 'state', state: 'loggedOut' });
      await tg.disconnect();
      tg = undefined;
      return;
    }

    panel.post({ type: 'state', state: 'connecting', detail: 'Loading history' });
    await tg.resolveBot(botUsername);
    const limit = vscode.workspace
      .getConfiguration('telegramAgentConsole')
      .get<number>('historyLimit') ?? 50;

    const [history, commands] = await Promise.all([
      tg.getHistory(limit),
      tg.getCommands(),
    ]);
    panel.post({ type: 'init', messages: history, botUsername, commands });

    tg.onMessage((m) => {
      panel.post({ type: 'newMessage', message: m });
      maybeNotify(m);
    });
    tg.startListening();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.appendLine('bootstrap failed: ' + msg);
    panel.post({ type: 'state', state: 'loggedOut', detail: msg });
    if (tg) {
      await tg.disconnect();
      tg = undefined;
    }
  } finally {
    bootstrapping = false;
  }
}

async function reconnect(): Promise<void> {
  if (tg) {
    await tg.disconnect();
    tg = undefined;
  }
  await bootstrap();
}

async function handleSend(tempId: string, text: string): Promise<void> {
  if (!tg) {
    panel.post({ type: 'sendError', tempId, error: 'Not connected' });
    return;
  }
  try {
    const sent = await tg.send(text);
    panel.post({ type: 'sendOk', tempId, message: sent });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.appendLine('send failed: ' + msg);
    panel.post({ type: 'sendError', tempId, error: msg });
  }
}

function maybeNotify(m: { outgoing: boolean; text: string }): void {
  if (m.outgoing) return;
  if (panel.isVisible()) return;
  const enabled = vscode.workspace
    .getConfiguration('telegramAgentConsole')
    .get<boolean>('notifyOnIncoming');
  if (!enabled) return;
  const preview = m.text.length > 80 ? m.text.slice(0, 77) + '...' : m.text;
  void vscode.window
    .showInformationMessage('Agent: ' + preview, 'Open')
    .then((choice) => {
      if (choice === 'Open') panel.reveal();
    });
}

async function doSetup(): Promise<void> {
  const apiIdRaw = await vscode.window.showInputBox({
    title: 'Telegram api_id',
    prompt: 'Numeric api_id from https://my.telegram.org/apps',
    ignoreFocusOut: true,
    validateInput: (v) => (/^\d+$/.test(v.trim()) ? null : 'Must be a number'),
  });
  if (!apiIdRaw) return;
  const apiHash = await vscode.window.showInputBox({
    title: 'Telegram api_hash',
    prompt: 'api_hash from https://my.telegram.org/apps',
    ignoreFocusOut: true,
    password: true,
    validateInput: (v) => (v.trim().length >= 16 ? null : 'Looks too short'),
  });
  if (!apiHash) return;
  const botUsername = await vscode.window.showInputBox({
    title: 'Bot username',
    prompt: 'Username of your bot (without @)',
    ignoreFocusOut: true,
    value: vscode.workspace
      .getConfiguration('telegramAgentConsole')
      .get<string>('botUsername') ?? '',
    validateInput: (v) => (v.trim().length > 0 ? null : 'Required'),
  });
  if (!botUsername) return;

  await credentials.setApiId(Number(apiIdRaw.trim()));
  await credentials.setApiHash(apiHash.trim());
  await vscode.workspace
    .getConfiguration('telegramAgentConsole')
    .update('botUsername', botUsername.trim().replace(/^@/, ''), vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage('Telegram Agent: credentials saved. Now run Login.');
  await reconnect();
}

async function doLogin(): Promise<void> {
  const apiId = await credentials.getApiId();
  const apiHash = await credentials.getApiHash();
  if (!apiId || !apiHash) {
    vscode.window.showWarningMessage('Run "Telegram Agent: Setup" first.');
    return;
  }

  panel.post({ type: 'state', state: 'connecting', detail: 'Logging in' });

  const callbacks: AuthCallbacks = {
    phoneNumber: async () => {
      const v = await vscode.window.showInputBox({
        title: 'Phone number (with country code)',
        prompt: 'e.g. +15551234567',
        ignoreFocusOut: true,
        validateInput: (s) => (/^\+?\d{6,}$/.test(s.trim()) ? null : 'Invalid format'),
      });
      if (!v) throw new Error('Login cancelled');
      return v.trim();
    },
    phoneCode: async () => {
      const v = await vscode.window.showInputBox({
        title: 'Login code',
        prompt: 'The code Telegram just sent you',
        ignoreFocusOut: true,
        validateInput: (s) => (s.trim().length > 0 ? null : 'Required'),
      });
      if (!v) throw new Error('Login cancelled');
      return v.trim();
    },
    password: async () => {
      const v = await vscode.window.showInputBox({
        title: 'Two-factor password',
        prompt: 'Cloud password (only if 2FA enabled)',
        ignoreFocusOut: true,
        password: true,
      });
      return v ?? '';
    },
    onError: (err) => output.appendLine('auth error: ' + err.message),
  };

  try {
    if (tg) {
      await tg.disconnect();
      tg = undefined;
    }
    const session = await credentials.getSession();
    tg = new TgClient(apiId, apiHash, session, (s) => output.appendLine(s));
    await tg.login(callbacks);
    const saved = tg.saveSession();
    await credentials.setSession(saved);
    vscode.window.showInformationMessage('Telegram Agent: logged in.');
    await reconnect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.appendLine('login failed: ' + msg);
    panel.post({ type: 'state', state: 'loggedOut', detail: msg });
    vscode.window.showErrorMessage('Login failed: ' + msg);
  }
}

async function doLogout(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Log out of Telegram? This clears the saved session but keeps your api_id/api_hash.',
    { modal: true },
    'Log out',
  );
  if (confirm !== 'Log out') return;
  await credentials.clearSession();
  if (tg) {
    await tg.disconnect();
    tg = undefined;
  }
  panel.post({ type: 'state', state: 'loggedOut' });
  vscode.window.showInformationMessage('Telegram Agent: logged out.');
}
