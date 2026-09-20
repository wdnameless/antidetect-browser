/**
 * Telegram per-event notification routing.
 *
 * The operator asked that every notification be independently configurable:
 * «все уведомления, которые могут приходить, должны настраиваться, отсылать их в Бот или нет».
 * Before this, one master switch governed three hardcoded messages, so keeping profile events while
 * dropping task-group chatter was impossible.
 *
 * What these tests defend, and why each one is worth keeping:
 *
 *  - a DISABLED key actually suppresses its own message while others still send. "There is a toggle
 *    in the UI" is not the same as "the toggle does something", and only this shows which one holds.
 *  - `agent.activity` defaults OFF for an install that has never saved settings. It is the one key
 *    with a non-true default, so it is the one a careless `?? true` would silently invert — and an
 *    agent acting many times a minute would make that failure look like a broken bot.
 *  - a partial save does not wipe the keys it does not mention, which is what lets the settings UI
 *    send one switch at a time without silently resetting the rest.
 *
 * The coalescing window is drained by awaiting the bot's own `flushNotifications()` rather than by
 * sleeping through it: the batcher is the thing under test, and a real 2-second wait per case would
 * both slow every run and go on failing under load for reasons unrelated to routing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FetchFn } from '../../src/main/telegram/bot';
import {
  getTelegramBotInstance,
  getTelegramSettings,
  saveTelegramSettings,
  resetTelegramBotInstance,
  setTelegramBotFetchSeam,
  notifyAgentActivity,
  notifyProfileStarted,
  notifyProfileEvent,
  notifyTaskGroupFinished,
  DEFAULT_TELEGRAM_EVENTS,
  TELEGRAM_EVENT_KEYS,
} from '../../src/main/telegram/bot';

interface CapturedSends {
  texts: string[];
  restore: () => void;
}

/** Captures every sendMessage call the bot makes during a test. */
function captureSends(): CapturedSends {
  const texts: string[] = [];
  setTelegramBotFetchSeam((async (url: string, init?: { body?: string }) => {
    if (String(url).includes('/sendMessage') && init?.body) {
      const parsed = JSON.parse(init.body) as { text?: string };
      if (parsed.text) texts.push(parsed.text);
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) } as unknown as globalThis.Response;
  }) as FetchFn);
  return { texts, restore: () => setTelegramBotFetchSeam(globalThis.fetch as FetchFn) };
}

/**
 * Sends everything queued, without waiting out the coalescing window.
 *
 * `flushNotifications` is the exact function the timer would call, so this exercises the real send
 * path and skips only the delay that exists to batch messages.
 */
async function deliver(): Promise<void> {
  await getTelegramBotInstance().flushNotifications();
}

describe('Telegram per-event notification routing', () => {
  let sends: CapturedSends;

  beforeEach(() => {
    resetTelegramBotInstance();
    sends = captureSends();
  });

  afterEach(() => {
    sends.restore();
    resetTelegramBotInstance();
    saveTelegramSettings({ token: '', chatIds: [], enabled: false, events: { ...DEFAULT_TELEGRAM_EVENTS } });
  });

  it('sends nothing at all while the bot is disabled', async () => {
    saveTelegramSettings({ token: 'tok', chatIds: ['1'], enabled: false, events: { ...DEFAULT_TELEGRAM_EVENTS } });
    notifyProfileStarted('p1', 'Profile One');
    await deliver();
    expect(sends.texts).toEqual([]);
  });

  it('suppresses only the disabled kind and still delivers the others', async () => {
    saveTelegramSettings({
      token: 'tok',
      chatIds: ['1'],
      enabled: true,
      events: { ...DEFAULT_TELEGRAM_EVENTS, 'taskgroup.finished': false },
    });

    notifyTaskGroupFinished('g1', 'finished', 'Group One');
    notifyProfileStarted('p1', 'Profile One');
    await deliver();

    const joined = sends.texts.join('\n');
    expect(joined).toContain('p1');
    // The task-group message must be absent, not merely outnumbered: this is the whole point of a
    // per-event switch.
    expect(joined).not.toContain('g1');
    expect(joined).not.toContain('Group One');
  });

  it('keeps agent activity off by default and delivers it once enabled', async () => {
    // No stored `events` at all — the state of an install that predates per-event settings.
    saveTelegramSettings({ token: 'tok', chatIds: ['1'], enabled: true });

    expect(getTelegramSettings().events['agent.activity']).toBe(false);

    notifyAgentActivity('Started p_abc');
    await deliver();
    expect(sends.texts.join('\n')).not.toContain('p_abc');

    saveTelegramSettings({
      token: 'tok',
      chatIds: ['1'],
      enabled: true,
      events: { ...DEFAULT_TELEGRAM_EVENTS, 'agent.activity': true },
    });
    notifyAgentActivity('Started p_abc');
    await deliver();
    expect(sends.texts.join('\n')).toContain('p_abc');
  });

  it('treats every kind except agent activity as on by default', async () => {
    // An operator upgrading should keep receiving what they already received.
    saveTelegramSettings({ token: 'tok', chatIds: ['1'], enabled: true });
    const events = getTelegramSettings().events;

    for (const key of TELEGRAM_EVENT_KEYS) {
      if (key === 'agent.activity') continue;
      expect(events[key], `${key} should default to enabled`).toBe(true);
    }
    expect(events['agent.activity']).toBe(false);
  });

  it('does not let a partial save reset the keys it omits', async () => {
    saveTelegramSettings({
      token: 'tok',
      chatIds: ['1'],
      enabled: true,
      events: { ...DEFAULT_TELEGRAM_EVENTS, 'agent.activity': true, 'profile.created': false },
    });

    // What a UI sending a single switch would do: omit the rest entirely.
    saveTelegramSettings({ token: 'tok', chatIds: ['1'], enabled: true });

    const events = getTelegramSettings().events;
    expect(events['agent.activity']).toBe(true);
    expect(events['profile.created']).toBe(false);
  });

  it('routes profile stop through its own key, not the start key', async () => {
    saveTelegramSettings({
      token: 'tok',
      chatIds: ['1'],
      enabled: true,
      events: { ...DEFAULT_TELEGRAM_EVENTS, 'profile.stopped': false },
    });

    notifyProfileStarted('p_start', 'Start');
    notifyProfileEvent('stopped', 'p_stop', 'Stop');
    await deliver();

    const joined = sends.texts.join('\n');
    expect(joined).toContain('p_start');
    expect(joined).not.toContain('p_stop');
  });
});
