import { describe, it, expect } from 'vitest';
import {
  composeTransportFlags,
} from '../../../src/main/proxy/transportPolicy';
import {
  getUdpRelayState,
  setUdpRelayState,
} from '../../../src/main/proxy/udpRelay';
describe('Leak Regression: Zero Host UDP/Egress Leak for Proxied Profiles', () => {
  it('enforces disable_non_proxied_udp and no direct host UDP fallback on SOCKS5 relay', () => {
    const flags = composeTransportFlags(
      { status: 'SOCKS5_FULL_PASS' },
      'socks5://10.0.0.1:1080'
    );

    // QUIC enabled via relay, WebRTC restricted to non-proxied udp disabled
    expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(flags).not.toContain('--disable-quic');
    // Ensure proxy-bypass-list excludes loopback only, never direct internet
    expect(flags).toContain('--proxy-bypass-list=<-loopback>');
  });

  it('fails closed by disabling QUIC when proxy lacks UDP support (preventing host QUIC leak)', () => {
    const flags = composeTransportFlags(
      { status: 'CONSTRAINED' },
      'socks5://10.0.0.1:1080'
    );

    expect(flags).toContain('--disable-quic');
    expect(flags).toContain('--disable-webrtc');
    expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });

  it('fails closed for HTTP proxies by disabling QUIC and WebRTC completely', () => {
    const flags = composeTransportFlags(
      { status: 'CONSTRAINED' },
      'http://10.0.0.1:8080'
    );

    expect(flags).toContain('--disable-quic');
    expect(flags).toContain('--disable-webrtc');
  });

  it('tracks relay state accurately to guarantee leak-free profile lifetime', () => {
    setUdpRelayState('leak-test-profile', 'relay');
    expect(getUdpRelayState('leak-test-profile')).toBe('relay');

    setUdpRelayState('leak-test-profile', 'quic-disabled');
    expect(getUdpRelayState('leak-test-profile')).toBe('quic-disabled');
  });
});
