import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startMcpWithService } from '../../src/main/index';
import { McpService } from '../../src/main/mcpService';

describe('startMcpWithService autostart (R07)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a) reports started: true on a successful start', async () => {
    const fakeStatus = {
      running: true,
      port: 50400,
      toolCount: 47,
      pid: 9999,
      lastError: null,
      uptimeSeconds: 1,
    };
    const mockService = {
      status: vi.fn().mockReturnValue({ running: false }),
      start: vi.fn().mockResolvedValue(fakeStatus),
      stop: vi.fn(),
    };
    vi.spyOn(McpService, 'getInstance').mockReturnValue(mockService as unknown as McpService);

    const result = await startMcpWithService();
    expect(result).toEqual({ started: true });
    expect(mockService.start).toHaveBeenCalledTimes(1);
  });

  it('b) reports started: false with reason and does NOT throw when start() throws', async () => {
    const mockService = {
      status: vi.fn().mockReturnValue({ running: false }),
      start: vi.fn().mockRejectedValue(new Error('Cannot find MCP entry')),
      stop: vi.fn(),
    };
    vi.spyOn(McpService, 'getInstance').mockReturnValue(mockService as unknown as McpService);

    let thrown: unknown = null;
    let result;
    try {
      result = await startMcpWithService();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(result).toEqual({ started: false, error: 'Cannot find MCP entry' });
  });

  it('b2) reports started: false with the reason when start throws — and does NOT throw', async () => {
    // `McpService.start()` reports failure by THROWING (it throws when the entry is missing, the
    // port never opens, etc.), not by returning a status with an error field — `McpStatusResponse`
    // has no `lastError`. An earlier version of this test invented one, which would have forced
    // production code to match a shape the service does not produce.
    const mockService = {
      status: vi.fn().mockReturnValue({ running: false }),
      start: vi.fn().mockRejectedValue(new Error('Port 50400 did not open in 8000ms')),
      stop: vi.fn(),
    };
    vi.spyOn(McpService, 'getInstance').mockReturnValue(mockService as unknown as McpService);

    const result = await startMcpWithService();
    expect(result).toEqual({ started: false, error: 'Port 50400 did not open in 8000ms' });
  });

  it('b3) reports started: false when start resolves without the server running', async () => {
    // The other half: a resolution that is not running must not be reported as success.
    const mockService = {
      status: vi.fn().mockReturnValue({ running: false }),
      start: vi.fn().mockResolvedValue({ running: false, toolCount: 0, httpUrl: null }),
      stop: vi.fn(),
    };
    vi.spyOn(McpService, 'getInstance').mockReturnValue(mockService as unknown as McpService);

    const result = await startMcpWithService();
    expect(result.started).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('c) does not start twice if already running (second call does not spawn a second server)', async () => {
    const fakeRunningStatus = {
      running: true,
      port: 50400,
      toolCount: 47,
      pid: 9999,
      lastError: null,
      uptimeSeconds: 15,
    };
    const mockService = {
      status: vi.fn().mockReturnValue(fakeRunningStatus),
      start: vi.fn(),
      stop: vi.fn(),
    };
    vi.spyOn(McpService, 'getInstance').mockReturnValue(mockService as unknown as McpService);

    const result = await startMcpWithService();
    expect(result).toEqual({ started: true });
    expect(mockService.start).not.toHaveBeenCalled();
  });
});
