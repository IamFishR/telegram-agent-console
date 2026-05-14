export type ChatButtonKind = 'url' | 'callback' | 'text' | 'unsupported';

export interface ChatButton {
  text: string;
  kind: ChatButtonKind;
  url?: string;
  row: number;
  col: number;
}

export interface ChatMessage {
  id?: number;
  tempId?: string;
  text: string;
  renderedHtml?: string;
  outgoing: boolean;
  timestamp: number;
  pending?: boolean;
  error?: string;
  buttons?: ChatButton[][];
}

export interface BotCommand {
  command: string;
  description: string;
}

export type ConnState =
  | 'noCredentials'
  | 'noBot'
  | 'loggedOut'
  | 'connecting'
  | 'connected';

export interface ConfigValues {
  apiId: string;
  apiHash: string;
  botUsername: string;
}

export type HostToWebview =
  | { type: 'state'; state: ConnState; detail?: string }
  | { type: 'init'; messages: ChatMessage[]; botUsername: string; commands: BotCommand[] }
  | { type: 'newMessage'; message: ChatMessage }
  | { type: 'sendOk'; tempId: string; message: ChatMessage }
  | { type: 'sendError'; tempId: string; error: string }
  | { type: 'commands'; commands: BotCommand[] }
  | { type: 'configValues'; values: ConfigValues }
  | { type: 'configSaved' }
  | { type: 'configError'; error: string }
  | { type: 'typing'; isTyping: boolean }
  | { type: 'buttonResult'; messageId: number; row: number; col: number; alert?: string; error?: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'send'; tempId: string; text: string }
  | { type: 'login' }
  | { type: 'setup' }
  | { type: 'openExternal'; url: string }
  | { type: 'openConfig' }
  | { type: 'saveConfig'; values: ConfigValues }
  | { type: 'clickButton'; messageId: number; row: number; col: number };
