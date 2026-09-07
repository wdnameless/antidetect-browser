import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransportDropMonitor } from '../../../src/main/proxy/transportDropMonitor';
import { registerActiveProfile } from '../../../src/main/proxy/transportPolicy';

describe('TransportDropMonitor', () => {
  const profileId = 'test-profile-drop-1';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it('single failure does NOT trigger notifyTransportLoss', async () => {
    const lossSpy = vi.fn();
    const unregister = registerActiveProfile(profileId, lossSpy);

    let callCount = 0;
    const fakeProbe = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Connection refused');
      }
    });

    const monitor = new TransportDropMonitor({
      profileId,
      host: '1.2.3.4',
      port: 8080,
      intervalMs: 1000,
      failureThreshold: 2,
      probe: fakeProbe,
    });

    monitor.start();

    // Advance 1 interval -> 1st failure
    await vi.advanceTimersByTimeAsync(1000);

    expect(monitor.getConsecutiveFailures()).toBe(1);
    expect(lossSpy).not.toHaveBeenCalled();

    monitor.stop();
    unregister();
  });

  it('two consecutive failures trigger exactly one notifyTransportLoss', async () => {
    const lossSpy = vi.fn();
    const unregister = registerActiveProfile(profileId, lossSpy);

    const fakeProbe = vi.fn().mockRejectedValue(new Error('Connection timed out'));

    const monitor = new TransportDropMonitor({
      profileId,
      host: '1.2.3.4',
      port: 8080,
      intervalMs: 1000,
      failureThreshold: 2,
      probe: fakeProbe,
    });

    monitor.start();

    // 1st interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getConsecutiveFailures()).toBe(1);
    expect(lossSpy).not.toHaveBeenCalled();

    // 2nd interval -> triggers notifyTransportLoss
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getConsecutiveFailures()).toBe(2);
    expect(lossSpy).toHaveBeenCalledTimes(1);
    expect(lossSpy).toHaveBeenCalledWith('proxy_connection_dropped');

    // 3rd interval -> consecutive failure increments, but no duplicate notification fired
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getConsecutiveFailures()).toBe(3);
    expect(lossSpy).toHaveBeenCalledTimes(1);

    monitor.stop();
    unregister();
  });

  it('success after failures resets counter and no trigger', async () => {
    const lossSpy = vi.fn();
    const unregister = registerActiveProfile(profileId, lossSpy);

    let callCount = 0;
    const fakeProbe = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Transient drop');
      }
      return; // success on second attempt
    });

    const monitor = new TransportDropMonitor({
      profileId,
      host: '1.2.3.4',
      port: 8080,
      intervalMs: 1000,
      failureThreshold: 2,
      probe: fakeProbe,
    });

    monitor.start();

    // 1st interval: fail
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getConsecutiveFailures()).toBe(1);
    expect(lossSpy).not.toHaveBeenCalled();

    // 2nd interval: success -> resets counter
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getConsecutiveFailures()).toBe(0);
    expect(lossSpy).not.toHaveBeenCalled();

    // 3rd interval: success again
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.getConsecutiveFailures()).toBe(0);
    expect(lossSpy).not.toHaveBeenCalled();

    monitor.stop();
    unregister();
  });

  it('stop() prevents further probes', async () => {
    const fakeProbe = vi.fn().mockResolvedValue(undefined);

    const monitor = new TransportDropMonitor({
      profileId,
      host: '1.2.3.4',
      port: 8080,
      intervalMs: 1000,
      failureThreshold: 2,
      probe: fakeProbe,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeProbe).toHaveBeenCalledTimes(1);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fakeProbe).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent', async () => {
    const fakeProbe = vi.fn().mockResolvedValue(undefined);

    const monitor = new TransportDropMonitor({
      profileId,
      host: '1.2.3.4',
      port: 8080,
      intervalMs: 1000,
      failureThreshold: 2,
      probe: fakeProbe,
    });

    monitor.start();
    monitor.start();
    monitor.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeProbe).toHaveBeenCalledTimes(1);

    monitor.stop();
  });
});
