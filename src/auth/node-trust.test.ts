import { describe, it, expect } from 'vitest';
import { sameOrigin, resolveTrustedNodeUrl } from './node-trust';

describe('sameOrigin', () => {
  it('is true for identical origins (ignoring path)', () => {
    expect(sameOrigin('https://node.example.com/a', 'https://node.example.com/b')).toBe(true);
  });
  it('is false for different hosts', () => {
    expect(sameOrigin('https://node.example.com', 'https://evil.com')).toBe(false);
  });
  it('is false for different ports (origin includes port)', () => {
    expect(sameOrigin('https://node.example.com:2428', 'https://node.example.com:9999')).toBe(false);
  });
  it('is false for different scheme (http vs https)', () => {
    expect(sameOrigin('http://node.example.com', 'https://node.example.com')).toBe(false);
  });
  it('is false when either url is malformed', () => {
    expect(sameOrigin('not a url', 'https://node.example.com')).toBe(false);
    expect(sameOrigin('https://node.example.com', '')).toBe(false);
  });
});

describe('resolveTrustedNodeUrl', () => {
  const initiated = 'https://my-node.example.com';

  it('uses the initiated node when the callback carries no node_url', () => {
    const r = resolveTrustedNodeUrl({ candidate: null, initiated });
    expect(r).toEqual({ url: initiated, rejected: false, unverified: false });
  });

  it('accepts a callback node_url that matches the initiated origin', () => {
    const r = resolveTrustedNodeUrl({ candidate: 'https://my-node.example.com/cb', initiated });
    expect(r.url).toBe('https://my-node.example.com/cb');
    expect(r.rejected).toBe(false);
  });

  it('REJECTS a callback node_url whose origin differs from the initiated node (exfiltration attempt)', () => {
    const r = resolveTrustedNodeUrl({ candidate: 'https://evil.com', initiated });
    expect(r).toEqual({ url: null, rejected: true, unverified: false });
  });

  it('REJECTS a same-host-different-port callback node_url', () => {
    const r = resolveTrustedNodeUrl({
      candidate: 'https://my-node.example.com:9999',
      initiated: 'https://my-node.example.com:2428',
    });
    expect(r.rejected).toBe(true);
    expect(r.url).toBeNull();
  });

  it('accepts a callback node_url in allowedNodeUrls when there is no initiated node', () => {
    const r = resolveTrustedNodeUrl({
      candidate: 'https://trusted.example.com/cb',
      initiated: null,
      allowedNodeUrls: ['https://trusted.example.com'],
    });
    expect(r.url).toBe('https://trusted.example.com/cb');
    expect(r.rejected).toBe(false);
  });

  it('REJECTS a callback node_url not in allowedNodeUrls when there is no initiated node', () => {
    const r = resolveTrustedNodeUrl({
      candidate: 'https://evil.com',
      initiated: null,
      allowedNodeUrls: ['https://trusted.example.com'],
    });
    expect(r).toEqual({ url: null, rejected: true, unverified: false });
  });

  it('accepts but flags as unverified when there is neither an initiated node nor an allowlist', () => {
    const r = resolveTrustedNodeUrl({ candidate: 'https://unknown.example.com', initiated: null });
    expect(r.url).toBe('https://unknown.example.com');
    expect(r.rejected).toBe(false);
    expect(r.unverified).toBe(true);
  });
});
