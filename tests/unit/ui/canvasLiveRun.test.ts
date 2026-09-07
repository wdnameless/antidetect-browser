import { describe, it, expect } from 'vitest';
import {
  extractScreenshotRef,
  extractNodeTiming,
  parseSseLine,
  reduceLogLines,
  shouldAutoScroll,
  MAX_LOG_LINES,
  SseLogEntry
} from '../../../src/renderer/src/flowLiveRun';

describe('flowLiveRun helper logic', () => {
  describe('extractScreenshotRef', () => {
    it('extracts base64 data URL from text', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const raw = `[INFO] Captured screenshot: ${dataUri}`;
      expect(extractScreenshotRef(raw)).toBe(dataUri);
    });

    it('extracts screenshot from JSON payload', () => {
      const json = JSON.stringify({
        level: 'info',
        screenshot: '/tmp/screenshots/step1.png',
        nodeId: 'node-shot'
      });
      expect(extractScreenshotRef(json)).toBe('/tmp/screenshots/step1.png');
    });

    it('extracts screenshot from screenshotPath in JSON', () => {
      const json = JSON.stringify({
        screenshotPath: 'C:\\Users\\test\\shot.png'
      });
      expect(extractScreenshotRef(json)).toBe('C:\\Users\\test\\shot.png');
    });

    it('extracts path from [SCREENSHOT] tag in plain text', () => {
      const text = '[SCREENSHOT] /var/app/preview.png';
      expect(extractScreenshotRef(text)).toBe('/var/app/preview.png');
    });

    it('extracts path from screenshot= format', () => {
      const text = 'node-2 completed screenshot=./out/snap.jpg';
      expect(extractScreenshotRef(text)).toBe('./out/snap.jpg');
    });

    it('returns null when no screenshot reference is present', () => {
      expect(extractScreenshotRef('Regular log line without images')).toBeNull();
      expect(extractScreenshotRef('')).toBeNull();
    });
  });

  describe('extractNodeTiming', () => {
    it('extracts node ID from node=<id>', () => {
      const res = extractNodeTiming('Executing step node=node-navigate-1 duration=450ms');
      expect(res.nodeId).toBe('node-navigate-1');
      expect(res.durationMs).toBe(450);
    });

    it('extracts timing in seconds and converts to ms', () => {
      const res = extractNodeTiming('[SPAN] node-eval-2 took 1.5s');
      expect(res.nodeId).toBe('node-eval-2');
      expect(res.durationMs).toBe(1500);
    });

    it('handles lines without duration or nodeId', () => {
      const res = extractNodeTiming('System initialized');
      expect(res.nodeId).toBeUndefined();
      expect(res.durationMs).toBeUndefined();
    });
  });

  describe('parseSseLine', () => {
    it('parses JSON log entry with metadata', () => {
      const payload = JSON.stringify({
        line: '[SPAN] node-123 finished duration=300ms',
        created_at: 1710000000000
      });
      const res = parseSseLine(payload);
      expect(res?.log).toBeDefined();
      expect(res?.log?.line).toBe('[SPAN] node-123 finished duration=300ms');
      expect(res?.log?.nodeId).toBe('node-123');
      expect(res?.log?.durationMs).toBe(300);
      expect(res?.log?.created_at).toBe(1710000000000);
    });

    it('parses terminal SSE end event (finished)', () => {
      const payload = JSON.stringify({
        event: 'end',
        status: 'finished',
        code: 0
      });
      const res = parseSseLine(payload);
      expect(res?.end).toBeDefined();
      expect(res?.end?.event).toBe('end');
      expect(res?.end?.status).toBe('finished');
      expect(res?.end?.code).toBe(0);
    });

    it('parses terminal SSE end event (error)', () => {
      const payload = JSON.stringify({
        event: 'end',
        status: 'error',
        error: 'Execution timed out'
      });
      const res = parseSseLine(payload);
      expect(res?.end?.status).toBe('error');
      expect(res?.end?.error).toBe('Execution timed out');
    });

    it('parses terminal SSE end event (stop)', () => {
      const payload = JSON.stringify({
        event: 'end',
        status: 'stop'
      });
      const res = parseSseLine(payload);
      expect(res?.end?.status).toBe('stop');
    });

    it('parses plain text line safely', () => {
      const res = parseSseLine('Connecting to browser socket...');
      expect(res?.log).toBeDefined();
      expect(res?.log?.line).toBe('Connecting to browser socket...');
      expect(res?.log?.created_at).toBeGreaterThan(0);
    });

    it('returns null for empty payload', () => {
      expect(parseSseLine('')).toBeNull();
      expect(parseSseLine('   ')).toBeNull();
    });
  });

  describe('reduceLogLines', () => {
    it('appends lines within limit', () => {
      const initial: SseLogEntry[] = [
        { line: 'line 1', raw: 'line 1' },
        { line: 'line 2', raw: 'line 2' }
      ];
      const next: SseLogEntry = { line: 'line 3', raw: 'line 3' };
      const res = reduceLogLines(initial, next, 5);
      expect(res).toHaveLength(3);
      expect(res[2].line).toBe('line 3');
    });

    it('caps log lines at max length (rolling buffer)', () => {
      const initial: SseLogEntry[] = Array.from({ length: 200 }, (_, i) => ({
        line: `line ${i}`,
        raw: `line ${i}`
      }));
      const next: SseLogEntry = { line: 'newest line 201', raw: 'newest line 201' };
      const res = reduceLogLines(initial, next, MAX_LOG_LINES);
      expect(res).toHaveLength(200);
      expect(res[0].line).toBe('line 1');
      expect(res[199].line).toBe('newest line 201');
    });
  });

  describe('shouldAutoScroll', () => {
    it('returns true when scrollHeight <= clientHeight', () => {
      expect(shouldAutoScroll(0, 300, 300)).toBe(true);
      expect(shouldAutoScroll(0, 200, 300)).toBe(true);
    });

    it('returns true when scrolled to bottom within threshold', () => {
      // scrollHeight: 1000, clientHeight: 400. Bottom is scrollTop: 600.
      expect(shouldAutoScroll(600, 1000, 400, 20)).toBe(true);
      expect(shouldAutoScroll(590, 1000, 400, 20)).toBe(true);
      expect(shouldAutoScroll(581, 1000, 400, 20)).toBe(true);
    });

    it('returns false when user scrolled up past threshold', () => {
      // distance from bottom: 1000 - (570 + 400) = 30px > 20px threshold
      expect(shouldAutoScroll(570, 1000, 400, 20)).toBe(false);
      expect(shouldAutoScroll(100, 1000, 400, 20)).toBe(false);
    });
  });
});
