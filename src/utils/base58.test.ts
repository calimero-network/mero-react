import { describe, expect, it } from 'vitest';
import { base58ToHex } from './base58';

describe('base58ToHex', () => {
  it('decodes single-symbol values', () => {
    expect(base58ToHex('1')).toBe('00');
    expect(base58ToHex('2')).toBe('01');
    expect(base58ToHex('z')).toBe('39');
  });

  it('preserves leading zero bytes from leading "1"s', () => {
    expect(base58ToHex('12')).toBe('0001');
  });

  it('decodes a 32-byte blob id to canonical lowercase hex', () => {
    expect(base58ToHex('CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB')).toBe(
      'aa'.repeat(32),
    );
    expect(base58ToHex('DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC')).toBe(
      'bb'.repeat(32),
    );
  });

  it('throws on characters outside the alphabet', () => {
    expect(() => base58ToHex('0OIl')).toThrow(/invalid base58 character/);
  });
});
