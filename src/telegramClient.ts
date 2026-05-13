import * as vscode from 'vscode';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent, Raw } from 'telegram/events';
import { ChatMessage, BotCommand, ChatButton } from './types';

export interface AuthCallbacks {
  phoneNumber(): Promise<string>;
  phoneCode(): Promise<string>;
  password(): Promise<string>;
  onError?(err: Error): void;
}

export class TgClient {
  private client?: TelegramClient;
  private botEntity?: Api.User;
  private botUsername?: string;
  private readonly session: StringSession;
  private listeners: Array<(m: ChatMessage) => void> = [];
  private typingListeners: Array<(isTyping: boolean) => void> = [];

  constructor(
    private readonly apiId: number,
    private readonly apiHash: string,
    sessionString: string,
    private readonly log: (s: string) => void,
  ) {
    this.session = new StringSession(sessionString);
  }

  private ensureClient(): TelegramClient {
    if (!this.client) {
      this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
        connectionRetries: 5,
        autoReconnect: true,
        useWSS: true,
      });
      try {
        (this.client as unknown as { setLogLevel(l: string): void }).setLogLevel('none');
      } catch {
        // ignore; logging is non-critical
      }
    }
    return this.client;
  }

  async tryConnect(): Promise<boolean> {
    const c = this.ensureClient();
    await c.connect();
    return c.checkAuthorization();
  }

  async login(cb: AuthCallbacks): Promise<void> {
    const c = this.ensureClient();
    await c.start({
      phoneNumber: () => cb.phoneNumber(),
      phoneCode: () => cb.phoneCode(),
      password: () => cb.password(),
      onError: (err: Error) => {
        this.log('login error: ' + err.message);
        cb.onError?.(err);
        throw err;
      },
    });
  }

  saveSession(): string {
    return this.session.save() as unknown as string;
  }

  async resolveBot(username: string): Promise<void> {
    const c = this.ensureClient();
    const clean = username.replace(/^@/, '');
    const entity = await c.getEntity(clean);
    if (!(entity instanceof Api.User) || !entity.bot) {
      throw new Error(`@${clean} is not a bot account`);
    }
    this.botEntity = entity;
    this.botUsername = clean;
  }

  async getHistory(limit: number): Promise<ChatMessage[]> {
    const c = this.ensureClient();
    if (!this.botEntity) throw new Error('Bot not resolved');
    const msgs = await c.getMessages(this.botEntity, { limit });
    // gramjs returns newest-first; we want chronological for display
    return msgs
      .slice()
      .reverse()
      .filter((m): m is Api.Message => m instanceof Api.Message)
      .map((m) => this.toChatMessage(m));
  }

  async getCommands(): Promise<BotCommand[]> {
    const c = this.ensureClient();
    if (!this.botEntity) return [];
    try {
      const full = await c.invoke(
        new Api.users.GetFullUser({ id: this.botEntity }),
      );
      const botInfoArr = (full.fullUser as unknown as { botInfo?: Api.BotInfo[] }).botInfo;
      const info: Api.BotInfo | undefined = Array.isArray(botInfoArr)
        ? botInfoArr[0]
        : (full.fullUser as unknown as { botInfo?: Api.BotInfo }).botInfo;
      const cmds = info?.commands ?? [];
      return cmds.map((cmd) => ({
        command: cmd.command,
        description: cmd.description,
      }));
    } catch (e) {
      this.log('getCommands failed: ' + (e instanceof Error ? e.message : String(e)));
      return [];
    }
  }

  async send(text: string): Promise<ChatMessage> {
    const c = this.ensureClient();
    if (!this.botEntity) throw new Error('Bot not resolved');
    const sent = await c.sendMessage(this.botEntity, { message: text });
    return this.toChatMessage(sent);
  }

  onMessage(cb: (m: ChatMessage) => void): vscode.Disposable {
    this.listeners.push(cb);
    return new vscode.Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    });
  }

  onTyping(cb: (isTyping: boolean) => void): vscode.Disposable {
    this.typingListeners.push(cb);
    return new vscode.Disposable(() => {
      this.typingListeners = this.typingListeners.filter((l) => l !== cb);
    });
  }

  startListening(): void {
    const c = this.ensureClient();
    if (!this.botUsername) return;
    c.addEventHandler(
      async (event: NewMessageEvent) => {
        const m = event.message;
        if (!(m instanceof Api.Message)) return;
        const cm = this.toChatMessage(m);
        for (const l of this.listeners) {
          try {
            l(cm);
          } catch (e) {
            this.log('listener threw: ' + (e instanceof Error ? e.message : String(e)));
          }
        }
      },
      new NewMessage({ chats: [this.botUsername] }),
    );

    c.addEventHandler(
      (update: Api.TypeUpdate) => {
        if (!(update instanceof Api.UpdateUserTyping)) return;
        if (!this.botEntity) return;
        if (update.userId.toString() !== this.botEntity.id.toString()) return;
        const isCancel = update.action instanceof Api.SendMessageCancelAction;
        for (const l of this.typingListeners) {
          try {
            l(!isCancel);
          } catch (e) {
            this.log('typing listener threw: ' + (e instanceof Error ? e.message : String(e)));
          }
        }
      },
      new Raw({ types: [Api.UpdateUserTyping] }),
    );
  }

  async clickButton(
    messageId: number,
    row: number,
    col: number,
  ): Promise<Api.messages.BotCallbackAnswer | undefined> {
    const c = this.ensureClient();
    if (!this.botEntity) throw new Error('Bot not resolved');
    const msgs = await c.getMessages(this.botEntity, { ids: [messageId] });
    const m = msgs[0];
    if (!m || !(m instanceof Api.Message)) {
      throw new Error('Message not found');
    }
    const rows = m.buttons;
    if (!rows || !rows[row] || !rows[row][col]) {
      throw new Error('Button not found');
    }
    const btn = rows[row][col];
    const result = await btn.click({});
    if (result instanceof Api.messages.BotCallbackAnswer) {
      return result;
    }
    return undefined;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        // ignore
      }
      this.client = undefined;
    }
  }

  private toChatMessage(m: Api.Message): ChatMessage {
    const buttons = this.extractButtons(m);
    const msg: ChatMessage = {
      id: m.id,
      text: m.message ?? '',
      outgoing: !!m.out,
      timestamp: (m.date ?? Math.floor(Date.now() / 1000)) * 1000,
    };
    if (buttons) msg.buttons = buttons;
    return msg;
  }

  private extractButtons(m: Api.Message): ChatButton[][] | undefined {
    const markup = m.replyMarkup;
    if (!markup) return undefined;
    let rows: Api.TypeKeyboardButtonRow[] | undefined;
    if (markup instanceof Api.ReplyInlineMarkup) {
      rows = markup.rows;
    } else if (markup instanceof Api.ReplyKeyboardMarkup) {
      rows = markup.rows;
    }
    if (!rows || rows.length === 0) return undefined;
    const out: ChatButton[][] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!(row instanceof Api.KeyboardButtonRow)) continue;
      const rowOut: ChatButton[] = [];
      for (let c = 0; c < row.buttons.length; c++) {
        rowOut.push(this.buttonToChat(row.buttons[c], r, c));
      }
      if (rowOut.length > 0) out.push(rowOut);
    }
    return out.length > 0 ? out : undefined;
  }

  private buttonToChat(
    btn: Api.TypeKeyboardButton,
    row: number,
    col: number,
  ): ChatButton {
    if (btn instanceof Api.KeyboardButtonUrl) {
      return { text: btn.text, kind: 'url', url: btn.url, row, col };
    }
    if (btn instanceof Api.KeyboardButtonWebView) {
      return { text: btn.text, kind: 'url', url: btn.url, row, col };
    }
    if (btn instanceof Api.KeyboardButtonCallback) {
      return { text: btn.text, kind: 'callback', row, col };
    }
    if (btn instanceof Api.KeyboardButton) {
      return { text: btn.text, kind: 'text', row, col };
    }
    const text = (btn as { text?: string }).text ?? '?';
    return { text, kind: 'unsupported', row, col };
  }
}
