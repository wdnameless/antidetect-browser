// Per-profile privacy knobs added for the create-form redesign: Do Not Track, blocked
// ports and the WebRTC IP-handling policy.
//
// Two things make these worth testing rather than trusting:
//
//  1. Each one is only real if the LAUNCHER applies it. Every switch below was checked
//     against the pinned kernel binary, because Chromium accepts an unknown switch and
//     silently ignores it — a control wired to a non-existent flag looks implemented while
//     doing nothing (`--fingerprint-screen-refresh-rate` was exactly that, and is why no
//     refresh-rate field ships).
//  2. Bad input must be refused, not coerced. A typo becoming "off" would tell the operator
//     they configured privacy they did not get.
import { describe, it, expect } from 'vitest';
import {
  normalizeDoNotTrack,
  normalizeBlockedPorts,
  normalizeWebrtcPolicy,
  parseBlockedPortsColumn,
} from '../../src/main/profiles/profileManager';

describe('do not track', () => {
  it('accepts the three modes the UI offers', () => {
    expect(normalizeDoNotTrack('off')).toBe('off');
    expect(normalizeDoNotTrack('on')).toBe('on');
    expect(normalizeDoNotTrack('auto')).toBe('auto');
  });

  it('treats missing input as unset rather than as a mode', () => {
    expect(normalizeDoNotTrack(null)).toBeNull();
    expect(normalizeDoNotTrack(undefined)).toBeNull();
  });

  it('refuses an unknown mode instead of silently choosing one', () => {
    // Coercing this to 'off' would report privacy the user never enabled.
    expect(() => normalizeDoNotTrack('enabled')).toThrow(/invalid do-not-track/i);
    expect(() => normalizeDoNotTrack('TRUE')).toThrow(/invalid do-not-track/i);
  });
});

describe('blocked ports', () => {
  it('deduplicates and sorts, so the stored set is canonical', () => {
    expect(normalizeBlockedPorts([5900, 3389, 5900])).toEqual([3389, 5900]);
  });

  it('treats missing input as an empty set', () => {
    expect(normalizeBlockedPorts(null)).toEqual([]);
    expect(normalizeBlockedPorts(undefined)).toEqual([]);
  });

  it('accepts the full port range', () => {
    expect(normalizeBlockedPorts([1, 65535])).toEqual([1, 65535]);
  });

  it('refuses a value that cannot be a port', () => {
    // 0 and >65535 cannot be expressed, so accepting them would produce a Chromium switch
    // that silently does nothing.
    expect(() => normalizeBlockedPorts([0])).toThrow(/invalid port/i);
    expect(() => normalizeBlockedPorts([65536])).toThrow(/invalid port/i);
    expect(() => normalizeBlockedPorts([1.5])).toThrow(/invalid port/i);
  });

  it('round-trips through the stored JSON column', () => {
    const stored = JSON.stringify(normalizeBlockedPorts([3389, 5900]));
    expect(parseBlockedPortsColumn(stored)).toEqual([3389, 5900]);
  });

  it('reads a legacy NULL or junk column as empty rather than throwing', () => {
    expect(parseBlockedPortsColumn(null)).toEqual([]);
    expect(parseBlockedPortsColumn('')).toEqual([]);
    expect(parseBlockedPortsColumn('not json')).toEqual([]);
    expect(parseBlockedPortsColumn('{"a":1}')).toEqual([]);
  });
});

describe('webrtc policy', () => {
  it('accepts exactly the policies the launcher passes through', () => {
    expect(normalizeWebrtcPolicy('default')).toBe('default');
    expect(normalizeWebrtcPolicy('disable_non_proxied_udp')).toBe('disable_non_proxied_udp');
    expect(normalizeWebrtcPolicy('proxy')).toBe('proxy');
  });

  it('treats missing input as Chromium default', () => {
    expect(normalizeWebrtcPolicy(null)).toBeNull();
    expect(normalizeWebrtcPolicy(undefined)).toBeNull();
  });

  it('refuses a policy Chromium would not understand', () => {
    // Forwarded verbatim to a command-line switch, so anything else must not reach it.
    expect(() => normalizeWebrtcPolicy('disable')).toThrow(/invalid WebRTC policy/i);
    expect(() => normalizeWebrtcPolicy('off')).toThrow(/invalid WebRTC policy/i);
  });
});
