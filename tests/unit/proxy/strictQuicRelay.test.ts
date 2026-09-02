import { describe, it, expect } from 'vitest';
import { StrictQuicRelayError } from '../../../src/main/proxy/transportPolicy';

describe('StrictQuicRelayError', () => {
  it('instantiates correctly with message and optional profileId/cause', () => {
    const cause = new Error('UDP socket bind failure');
    const err = new StrictQuicRelayError('UDP relay setup failed under strict policy', {
      profileId: 'test-profile-strict',
      cause,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StrictQuicRelayError);
    expect(err.name).toBe('StrictQuicRelayError');
    expect(err.message).toBe('UDP relay setup failed under strict policy');
    expect(err.profileId).toBe('test-profile-strict');
    expect(err.cause).toBe(cause);
  });

  it('preserves prototype chain across instanceof checks', () => {
    const err = new StrictQuicRelayError('strict failure');
    expect(err instanceof StrictQuicRelayError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
