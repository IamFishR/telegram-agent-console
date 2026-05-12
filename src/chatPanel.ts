import * as vscode from 'vscode';
import { ConfigValues, HostToWebview, WebviewToHost } from './types';

export interface ChatPanelHandlers {
  onReady(): void;
  onSend(tempId: string, text: string): void;
  onLogin(): void;
  onSetup(): void;
  onOpenConfig(): void;
  onSaveConfig(values: ConfigValues): void;
}

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'telegram-agent-console.chat';

  private view?: vscode.WebviewView;
  private webviewReady = false;
  private outbox: HostToWebview[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ChatPanelHandlers,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.webviewReady = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      switch (msg.type) {
        case 'ready':
          this.webviewReady = true;
          for (const queued of this.outbox) {
            view.webview.postMessage(queued);
          }
          this.outbox = [];
          this.handlers.onReady();
          break;
        case 'send':
          this.handlers.onSend(msg.tempId, msg.text);
          break;
        case 'login':
          this.handlers.onLogin();
          break;
        case 'setup':
          this.handlers.onSetup();
          break;
        case 'openExternal':
          if (typeof msg.url === 'string' && /^(https?|tg):\/\//i.test(msg.url)) {
            void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
        case 'openConfig':
          this.handlers.onOpenConfig();
          break;
        case 'saveConfig':
          this.handlers.onSaveConfig(msg.values);
          break;
      }
    });

    view.onDidDispose(() => {
      this.view = undefined;
      this.webviewReady = false;
    });
  }

  post(msg: HostToWebview): void {
    if (this.view && this.webviewReady) {
      void this.view.webview.postMessage(msg);
    } else {
      this.outbox.push(msg);
    }
  }

  isVisible(): boolean {
    return !!this.view?.visible;
  }

  reveal(): void {
    if (this.view) {
      this.view.show(true);
    } else {
      void vscode.commands.executeCommand('telegram-agent-console.chat.focus');
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Agent Chat</title>
</head>
<body>
  <div id="root">
    <div id="status-bar"></div>
    <div id="messages"></div>
    <div id="config-view" class="hidden"></div>
    <div id="composer">
      <div id="suggestions" class="hidden"></div>
      <textarea id="input" rows="1" placeholder="Message" disabled></textarea>
      <div class="composer-row">
        <span class="hint">Enter to send, Shift+Enter for newline</span>
        <button id="send" disabled>Send</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
