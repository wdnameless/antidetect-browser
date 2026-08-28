import { describe, it, expect, vi } from 'vitest';
import { InputDebouncer, shouldForwardEvent } from '../../src/main/syncer/inputDebounce';

describe('input debounce batcher (Sprint 3.2)', () => {
  it('coalesces rapid keystrokes into a single flush per field', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const d = new InputDebouncer(300);
    d.push('user::#login-form > input:nth-of-type(1)', 'a', flush);
    d.push('user::#login-form > input:nth-of-type(1)', 'ab', flush);
    d.push('user::#login-form > input:nth-of-type(1)', 'abc', flush);
    expect(flush).not.toHaveBeenCalled();
    expect(d.size).toBe(1);
    vi.advanceTimersByTime(300);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith({
      fieldKey: 'user::#login-form > input:nth-of-type(1)',
      value: 'abc', // last snapshot wins
    });
    vi.useRealTimers();
  });

  it('keeps different fields independent', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const d = new InputDebouncer(300);
    d.push('f1', 'one', flush);
    d.push('f2', 'two', flush);
    expect(d.pendingKeys.sort()).toEqual(['f1', 'f2']);
    vi.advanceTimersByTime(300);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledWith({ fieldKey: 'f1', value: 'one' });
    expect(flush).toHaveBeenCalledWith({ fieldKey: 'f2', value: 'two' });
    vi.useRealTimers();
  });

  it('flushNow fires immediately and cancels the timer', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const d = new InputDebouncer(300);
    d.push('email', 'a@b', flush);
    expect(d.flushNow('f-missing', flush)).toBe(false);
    expect(d.flushNow('email', flush)).toBe(true);
    expect(flush).toHaveBeenCalledWith({ fieldKey: 'email', value: 'a@b' });
    // timer must not fire again
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(d.size).toBe(0);
    vi.useRealTimers();
  });

  it('re-push reschedules the window (typing pauses reset the timer)', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const d = new InputDebouncer(300);
    d.push('f', 'x', flush);
    vi.advanceTimersByTime(250);
    d.push('f', 'xy', flush); // reschedule
    vi.advanceTimersByTime(250);
    expect(flush).not.toHaveBeenCalled(); // only 250ms since the 2nd push
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('flushAll drains everything; clear drops without flushing', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const d = new InputDebouncer(300);
    d.push('a', '1', flush);
    d.push('b', '2', flush);
    d.flushAll(flush);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(d.size).toBe(0);

    d.push('c', '3', flush);
    d.clear();
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('event dedup / cascade guard', () => {
  it('never forwards to the event source (master)', () => {
    expect(shouldForwardEvent('master', 'master', false)).toBe(false);
    expect(shouldForwardEvent('master', 'slave1', false)).toBe(true);
  });

  it('never forwards into a page already replaying (isSlave)', () => {
    expect(shouldForwardEvent('master', 'slave1', true)).toBe(false);
    expect(shouldForwardEvent('slave1', 'slave2', true)).toBe(false);
    expect(shouldForwardEvent('master', 'slave2', false)).toBe(true);
  });
});