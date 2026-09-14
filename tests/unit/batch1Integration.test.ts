import './_batch1Port';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { TelegramCommandHandlers } from '../../src/main/telegram/bot';
import { initDb, closeDb } from '../../src/main/db';
import { getApiKey } from '../../src/main/config';
import { startApi } from '../../src/main/api/server';
import { createProfile, setStatus } from '../../src/main/profiles/profileManager';
import { createTaskGroup } from '../../src/main/scripts/taskGroups';
import { getTaskQueueCoordinator } from '../../src/main/scripts/taskQueue';
import { wireTelegramBot } from '../../src/main/index';
import { seedDevices } from '../../src/main/devices/deviceManager';

const mocks = vi.hoisted(() => {
  const botStub = {
    setCommandHandlers: vi.fn(),
    isEnabled: vi.fn(() => false),
  };
  return {
    botStub,
    notifyStarted: vi.fn(),
    notifyStopped: vi.fn(),
    notifyGroupFinished: vi.fn(),
    resetInstance: vi.fn(),
    getCdpEndpoint: vi.fn(),
    startProfile: vi.fn(),
    stopProfile: vi.fn(),
    isRunning: vi.fn(() => false),
    stopAll: vi.fn(),
    getTelegramBotInstance: () => botStub,
  } as const;
});

vi.mock('../../src/main/telegram/bot', () => ({
  getTelegramBotInstance: mocks.getTelegramBotInstance,
  resetTelegramBotInstance: mocks.resetInstance,
  notifyProfileStarted: mocks.notifyStarted,
  notifyProfileStopped: mocks.notifyStopped,
  notifyTaskGroupFinished: mocks.notifyGroupFinished,
}));

vi.mock('../../src/main/launcher/chromium', () => ({
  startProfile: mocks.startProfile,
  stopProfile: mocks.stopProfile,
  isRunning: mocks.isRunning,
  stopAll: mocks.stopAll,
  getCdpEndpoint: mocks.getCdpEndpoint,
}));

// Resolved by createProfile in beforeAll; the running/live state comes from mocks.
let chromeId = '';
let firefoxId = '';

beforeAll(async () => {
  await initDb(':memory:');
  seedDevices();
  chromeId = createProfile({ name: 'Runner', browser_type: 'chromium' });
  firefoxId = createProfile({ name: 'Fox', browser_type: 'firefox' });
  await startApi();
});

afterAll(() => {
  closeDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isRunning.mockImplementation((id: string) => id === chromeId);
  mocks.startProfile.mockResolvedValue({
    pid: 123,
    ws: { puppeteer: '', selenium: '' },
    debug_port: '0',
    webdriver: '',
  });
  mocks.stopProfile.mockResolvedValue(true);
});

describe('Batch-1 integration: email router mounted (live server)', () => {
  it('GET /api/v1/email/accounts is reachable through the real server', async () => {
    const key = getApiKey();
    const res = await fetch(`http://127.0.0.1:52931/api/v1/email/accounts`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: number; data: unknown };
    expect(body.code).toBe(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('email route stays behind the Bearer auth middleware', async () => {
    const res = await fetch(`http://127.0.0.1:52931/api/v1/email/accounts`);
    expect(res.status).toBe(401);
  });
});

describe('Batch-1 integration: telegram wiring', () => {
  function wiredHandlers(): TelegramCommandHandlers {
    const bot = mocks.getTelegramBotInstance();
    expect(bot.setCommandHandlers).toHaveBeenCalled();
    // handlers object produced by wireTelegramBot's setCommandHandlers call
    return bot.setCommandHandlers.mock.calls[0][0] as TelegramCommandHandlers;
  }

  it('wireTelegramBot constructs the singleton and binds all four commands', () => {
    wireTelegramBot();
    const handlers = wiredHandlers();
    expect(typeof handlers.start).toBe('function');
    expect(typeof handlers.stop).toBe('function');
    expect(typeof handlers.status).toBe('function');
    expect(typeof handlers.list).toBe('function');
  });

  it('profile status changes fire the notification helpers with the display name', () => {
    wireTelegramBot();
    setStatus(chromeId, 'running');
    expect(mocks.notifyStarted).toHaveBeenCalledWith(chromeId, 'Runner');

    setStatus(chromeId, 'closed');
    expect(mocks.notifyStopped).toHaveBeenCalledWith(chromeId, 'Runner');

    setStatus(chromeId, 'error');
    expect(mocks.notifyStopped).toHaveBeenCalledWith(chromeId, 'Runner');
  });

  it('/start resolves the launch config: chromium launches, firefox answers honestly', async () => {
    wireTelegramBot();
    const handlers = wiredHandlers();

    const started = await handlers.start(chromeId);
    expect(mocks.startProfile).toHaveBeenCalledTimes(1);
    expect(mocks.startProfile.mock.calls[0][0].profileId).toBe(chromeId);
    expect(started).toContain('started');
    expect(started).toContain('123');

    const fx = await handlers.start(firefoxId);
    expect(mocks.startProfile).toHaveBeenCalledTimes(1);
    expect(fx.toLowerCase()).toContain('firefox');

    const missing = await handlers.start('no-such-id');
    expect(mocks.startProfile).toHaveBeenCalledTimes(1);
    expect(missing).toContain('failed');

    const usage = await handlers.start('');
    expect(usage.toLowerCase()).toContain('usage');
  });

  it('/stop, /status and /list answer per the contract', async () => {
    wireTelegramBot();
    const handlers = wiredHandlers();

    const stopped = await handlers.stop(chromeId);
    expect(mocks.stopProfile).toHaveBeenCalledWith(chromeId);
    expect(stopped).toContain('stopped');

    const status = await handlers.status();
    expect(status).toContain('Running: 1'); // chromeId is running per mock, firefoxId closed

    const list = await handlers.list();
    expect(list).toContain('Runner');
    expect(list).toContain('Fox');
    expect(list).toContain('running');
    expect(list).toContain('closed');
  });

  it('task-group completion: coordinator group-finished dispatches notifyTaskGroupFinished with the group name', () => {
    wireTelegramBot();
    const group = createTaskGroup({ name: 'TG Alpha', script_id: 's1', profile_ids: [chromeId] });
    const coordinator = getTaskQueueCoordinator();
    expect(coordinator.listenerCount('group-finished')).toBeGreaterThanOrEqual(1);

    coordinator.emit('group-finished', group.id, 'finished');
    expect(mocks.notifyGroupFinished).toHaveBeenCalledWith(group.id, 'finished', 'TG Alpha');
  });
});
