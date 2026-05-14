import * as vscode from 'vscode';
import { TgClient, AuthCallbacks } from './telegramClient';
import { Credentials } from './credentials';
import { ChatPanel } from './chatPanel';
import { ChatMessage, ConfigValues } from './types';

async function withRenderedHtml(msg: ChatMessage): Promise<ChatMessage> {
  if (msg.outgoing || !msg.text) return msg;
  try {
    const html = await vscode.commands.executeCommand<string>('markdown.api.render', msg.text);
    return { ...msg, renderedHtml: html ?? undefined };
  } catch {
    return msg;
  }
}

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
    onOpenConfig: () => { void doOpenConfig(); },
    onSaveConfig: (values) => { void doSaveConfig(values); },
    onClickButton: (messageId, row, col) => { void handleClickButton(messageId, row, col); },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, panel),
    vscode.commands.registerCommand('telegram-agent-console.setup', doSetup),
    vscode.commands.registerCommand('telegram-agent-console.config', doOpenConfigCommand),
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
    const renderedHistory = await Promise.all(history.map(withRenderedHtml));
    panel.post({ type: 'init', messages: renderedHistory, botUsername, commands });

    tg.onMessage(async (m) => {
      const rendered = await withRenderedHtml(m);
      panel.post({ type: 'newMessage', message: rendered });
      maybeNotify(m);
    });
    tg.onTyping((isTyping) => {
      panel.post({ type: 'typing', isTyping });
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

async function handleClickButton(
  messageId: number,
  row: number,
  col: number,
): Promise<void> {
  if (!tg) {
    panel.post({ type: 'buttonResult', messageId, row, col, error: 'Not connected' });
    return;
  }
  try {
    const answer = await tg.clickButton(messageId, row, col);
    const alert = answer?.message;
    panel.post({ type: 'buttonResult', messageId, row, col, alert });
    if (answer?.alert && alert) {
      void vscode.window.showInformationMessage(alert);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.appendLine('button click failed: ' + msg);
    panel.post({ type: 'buttonResult', messageId, row, col, error: msg });
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

async function doOpenConfig(): Promise<void> {
  const apiId = await credentials.getApiId();
  const apiHash = await credentials.getApiHash();
  const botUsername = (vscode.workspace
    .getConfiguration('telegramAgentConsole')
    .get<string>('botUsername') ?? '').trim();
  panel.post({
    type: 'configValues',
    values: {
      apiId: apiId !== undefined ? String(apiId) : '',
      apiHash: apiHash ?? '',
      botUsername,
    },
  });
}

async function doOpenConfigCommand(): Promise<void> {
  panel.reveal();
  await doOpenConfig();
}

async function doSaveConfig(values: ConfigValues): Promise<void> {
  const apiIdStr = (values.apiId ?? '').trim();
  const apiHash = (values.apiHash ?? '').trim();
  const botUsername = (values.botUsername ?? '').trim().replace(/^@/, '');

  if (!/^\d+$/.test(apiIdStr)) {
    panel.post({ type: 'configError', error: 'API ID must be a number.' });
    return;
  }
  if (apiHash.length < 16) {
    panel.post({ type: 'configError', error: 'API hash looks too short.' });
    return;
  }
  if (!botUsername) {
    panel.post({ type: 'configError', error: 'Bot username is required.' });
    return;
  }

  const newApiId = Number(apiIdStr);
  const prevApiId = await credentials.getApiId();
  const prevApiHash = await credentials.getApiHash();
  const credsChanged = prevApiId !== newApiId || prevApiHash !== apiHash;

  try {
    await credentials.setApiId(newApiId);
    await credentials.setApiHash(apiHash);
    await vscode.workspace
      .getConfiguration('telegramAgentConsole')
      .update('botUsername', botUsername, vscode.ConfigurationTarget.Global);

    if (credsChanged) {
      // Session is bound to the old api_id/api_hash; drop it so the user re-logs in.
      await credentials.clearSession();
    }

    panel.post({ type: 'configSaved' });
    vscode.window.showInformationMessage(
      credsChanged
        ? 'Telegram Agent: settings saved. Session cleared — run Login.'
        : 'Telegram Agent: settings saved.',
    );
    await reconnect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    panel.post({ type: 'configError', error: msg });
  }
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
