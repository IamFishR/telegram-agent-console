import * as vscode from 'vscode';

const KEY_API_ID = 'telegramAgent.apiId';
const KEY_API_HASH = 'telegramAgent.apiHash';
const KEY_SESSION = 'telegramAgent.session';

export class Credentials {
  constructor(private readonly storage: vscode.SecretStorage) {}

  async getApiId(): Promise<number | undefined> {
    const v = await this.storage.get(KEY_API_ID);
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async getApiHash(): Promise<string | undefined> {
    return this.storage.get(KEY_API_HASH);
  }

  async getSession(): Promise<string> {
    return (await this.storage.get(KEY_SESSION)) ?? '';
  }

  async setApiId(id: number): Promise<void> {
    await this.storage.store(KEY_API_ID, String(id));
  }

  async setApiHash(hash: string): Promise<void> {
    await this.storage.store(KEY_API_HASH, hash);
  }

  async setSession(s: string): Promise<void> {
    await this.storage.store(KEY_SESSION, s);
  }

  async clearSession(): Promise<void> {
    await this.storage.delete(KEY_SESSION);
  }
}
