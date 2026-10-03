// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NODE_KEY = 'ab'.repeat(32);
const RELAY = 'https://node-x.relay.cloud.calimero.network';

const dcapVerify = vi.fn(() => ({ status: 'UpToDate' }));

// What the verifier is handed is what the quote check calls. A non-function
// here is the hosted-relay failure: the quote never verifies, no key is
// pinned, no session is minted, and every admin read is a 401.
vi.mock('@calimero-network/mero-js', async (importActual) => ({
  ...(await importActual<typeof import('@calimero-network/mero-js')>()),
  createSignedReleaseVerifier:
    (opts: { dcapVerify: unknown }) =>
    async (): Promise<void> => {
      if (typeof opts.dcapVerify !== 'function') throw new TypeError('dcapVerify is not a function');
      (opts.dcapVerify as () => unknown)();
    },
  attestRelayNodeKey: async ({ verify }: { verify?: (a: unknown) => Promise<void> }) => {
    await verify?.({});
    return { nodeKey: NODE_KEY };
  },
}));

// `@phala/dcap-qvl` is CommonJS (`module.exports = { verify, … }`). A bundler
// that pre-bundles it for the browser — Vite's dev optimizer, for one — hands a
// dynamic import back as a namespace whose only export is `default`, so the
// named `verify` is not there. This is that shape.
vi.mock('@phala/dcap-qvl', () => ({ default: { verify: dcapVerify }, verify: undefined }));

describe('resolveRelayNodeKey on a hosted relay', () => {
  beforeEach(() => {
    localStorage.clear();
    dcapVerify.mockClear();
  });

  it('verifies the quote when the verifier library arrives as a CommonJS default export', async () => {
    const { resolveRelayNodeKey, readPinnedRelayNodeKey } = await import('./session');

    await expect(resolveRelayNodeKey(RELAY)).resolves.toBe(NODE_KEY);
    expect(dcapVerify).toHaveBeenCalledTimes(1);
    expect(readPinnedRelayNodeKey(RELAY)).toBe(NODE_KEY);
  });
});
