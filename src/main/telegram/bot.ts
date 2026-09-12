import { getSetting, setSetting } from '../config';

export interface TelegramSettings {
  token: string;
  chatIds: string[];
  enabled: boolean;
}

export type FetchFn = typeof globalThis.fetch;

let fetchSeam: FetchFn = globalThis.fetch;

export function setTelegramBotFetchSeam(seam: FetchFn): void {
  fetchSeam = seam;
}

export interface TelegramCommandHandlers {
  start?: (arg: string) => Promise<string>;
  stop?: (arg: string) => Promise<string>;
  status?: () => Promise<string>;
  list?: () => Promise<string>;
}

export class TelegramBot {
  private token: string;
  private chatIds: Set<string>;
  private enabled: boolean;
  private offset = 0;
  private isPolling = false;
  private stopRequested = false;
  private consecutiveErrors = 0;
  private coalescingTimer: NodeJS.Timeout | null = null;
  private queuedNotifications: string[] = [];
  private commandHandlers: TelegramCommandHandlers = {};

  constructor(settings: TelegramSettings) {
    this.token = settings.token;
    this.chatIds = new Set(settings.chatIds.map(String));
    this.enabled = settings.enabled;
  }

  public updateSettings(settings: TelegramSettings): void {
    this.token = settings.token;
    this.chatIds = new Set(settings.chatIds.map(String));
    this.enabled = settings.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled && !!this.token;
  }

  public setCommandHandlers(handlers: TelegramCommandHandlers): void {
    this.commandHandlers = handlers;
  }

  public resetBackoff(): void {
    this.consecutiveErrors = 0;
  }

  public async handlePollError(status?: number, responseData?: unknown): Promise<number> {
    const data = responseData as { parameters?: { retry_after?: number } } | undefined;
    if (status === 429 && data?.parameters?.retry_after) {
      return data.parameters.retry_after * 1000;
    }
    this.consecutiveErrors++;
    const backoff = Math.min(1000 * Math.pow(2, this.consecutiveErrors - 1), 60000);
    return backoff;
  }

  public async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
      const res = await fetchSeam(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public notify(message: string): void {
    if (!this.isEnabled()) return;
    this.queuedNotifications.push(message);

    if (!this.coalescingTimer) {
      this.coalescingTimer = setTimeout(() => {
        this.flushNotifications();
      }, 2000);
    }
  }

  public async flushNotifications(): Promise<void> {
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
    }

    if (this.queuedNotifications.length === 0) return;

    const messages = [...this.queuedNotifications];
    this.queuedNotifications = [];
    const combined = messages.join('\n');

    for (const chatId of this.chatIds) {
      await this.sendMessage(chatId, combined);
    }
  }

  public async executeCommand(chatId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    let reply = '';
    switch (cmd) {
      case '/start':
        if (this.commandHandlers.start) {
          reply = await this.commandHandlers.start(arg);
        } else {
          reply = 'Start command received';
        }
        break;
      case '/stop':
        if (this.commandHandlers.stop) {
          reply = await this.commandHandlers.stop(arg);
        } else {
          reply = 'Stop command received';
        }
        break;
      case '/status':
        if (this.commandHandlers.status) {
          reply = await this.commandHandlers.status();
        } else {
          reply = 'Status: running';
        }
        break;
      case '/list':
        if (this.commandHandlers.list) {
          reply = await this.commandHandlers.list();
        } else {
          reply = 'No profiles configured';
        }
        break;
      default:
        reply = `Unknown command: ${cmd}`;
        break;
    }

    if (reply) {
      await this.sendMessage(chatId, reply);
    }
  }

  public async pollOnce(): Promise<void> {
    if (!this.token) return;
    try {
      const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=10`;
      const res = await fetchSeam(url);
      const data = (await res.json()) as {
        ok?: boolean;
        result?: Array<{
          update_id: number;
          message?: { text?: string; chat?: { id?: number | string } };
        }>;
        parameters?: { retry_after?: number };
      };

      if (!res.ok || !data.ok) {
        const delay = await this.handlePollError(res.status, data);
        return;
      }

      this.resetBackoff();

      const updates = data.result || [];
      for (const update of updates) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = String(msg.chat?.id ?? '');
        if (!this.chatIds.has(chatId)) {
          // Whitelist refusal: unknown chats get a single refusal, not an error echo
          await this.sendMessage(chatId, 'Unauthorized: chat ID not whitelisted.');
          continue;
        }

        await this.executeCommand(chatId, msg.text);
      }
    } catch {
      await this.handlePollError();
    }
  }

  public startPolling(): void {
    if (this.isPolling || !this.isEnabled()) return;
    this.isPolling = true;
    this.stopRequested = false;

    const pollLoop = async () => {
      while (!this.stopRequested && this.isEnabled()) {
        await this.pollOnce();
      }
      this.isPolling = false;
    };

    pollLoop().catch(() => {
      this.isPolling = false;
    });
  }

  public stopPolling(): void {
    this.stopRequested = true;
    this.isPolling = false;
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
    }
  }
}

export function getTelegramSettings(): TelegramSettings {
  const token = (getSetting('telegram_bot_token') as string) || '';
  const rawChatIds = (getSetting('telegram_chat_ids') as string[]) || [];
  const enabled = (getSetting('telegram_bot_enabled') as boolean) || false;

  return {
    token,
    chatIds: Array.isArray(rawChatIds) ? rawChatIds : [],
    enabled: Boolean(enabled),
  };
}

export function saveTelegramSettings(settings: TelegramSettings): void {
  setSetting('telegram_bot_token', settings.token);
  setSetting('telegram_chat_ids', settings.chatIds);
  setSetting('telegram_bot_enabled', settings.enabled);

  // Update singleton instance if present
  if (globalTelegramBot) {
    globalTelegramBot.updateSettings(settings);
    if (!settings.enabled) {
      globalTelegramBot.stopPolling();
    } else {
      globalTelegramBot.startPolling();
    }
  }
}

let globalTelegramBot: TelegramBot | null = null;

export function getTelegramBotInstance(): TelegramBot {
  if (!globalTelegramBot) {
    const settings = getTelegramSettings();
    globalTelegramBot = new TelegramBot(settings);
  }
  return globalTelegramBot;
}

export function resetTelegramBotInstance(): void {
  if (globalTelegramBot) {
    globalTelegramBot.stopPolling();
  }
  globalTelegramBot = null;
}

export function notifyProfileStarted(profileId: string, profileName?: string): void {
  notifyProfileEvent('started', profileId, profileName);
}

export function notifyProfileStopped(profileId: string, profileName?: string): void {
  notifyProfileEvent('stopped', profileId, profileName);
}

export function notifyProfileEvent(action: 'started' | 'stopped', profileId: string, profileName?: string): void {
  // (body below)
  const bot = getTelegramBotInstance();
  if (!bot.isEnabled()) return;
  const nameDisplay = profileName ? ` (${profileName})` : '';
  bot.notify(`Profile ${action}: ${profileId}${nameDisplay}`);
}

export function notifyTaskGroupFinished(groupId: string | number, status: string, groupName?: string): void {
  const bot = getTelegramBotInstance();
  if (!bot.isEnabled()) return;
  const nameDisplay = groupName ? ` (${groupName})` : '';
  bot.notify(`Task group finished: ${groupId}${nameDisplay} with status: ${status}`);
}
