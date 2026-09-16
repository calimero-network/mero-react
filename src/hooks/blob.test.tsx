// @vitest-environment jsdom

import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlobInfo, useBlobUrl, useUploadBlob } from './index';
import { useMero } from '../context';

vi.mock('../context', () => ({
  useMero: vi.fn(),
}));

const mockUseMero = vi.mocked(useMero);

function createMero(adminOverrides: Record<string, unknown> = {}) {
  return {
    admin: {
      getBlob: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      getBlobInfo: vi.fn().mockResolvedValue({ blobId: 'blob-1', size: 10, source: 'local' }),
      uploadBlob: vi.fn().mockResolvedValue({ blobId: 'blob-1', size: 10 }),
      ...adminOverrides,
    },
  };
}

/** An HTTPError-shaped rejection: what mero-js throws on a non-2xx. */
function httpError(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { name: 'HTTPError', status });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  let seq = 0;
  // jsdom does not implement the object-URL store, so stub both halves; the
  // revocation assertions read straight off these.
  createObjectURL = vi.fn(() => `blob:mock/${++seq}`);
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useBlobInfo', () => {
  it('does not fetch when blobId is null', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobInfo(null));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mero.admin.getBlobInfo).not.toHaveBeenCalled();
    expect(result.current.info).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it('reads locally when no contextId is supplied', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobInfo('blob-1'));

    await waitFor(() => {
      expect(result.current.info?.blobId).toBe('blob-1');
    });
    expect(mero.admin.getBlobInfo).toHaveBeenCalledWith('blob-1', undefined);
  });

  it('opts into discovery when a contextId is supplied', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobInfo('blob-1', { contextId: 'ctx-1' }));

    await waitFor(() => {
      expect(result.current.info?.blobId).toBe('blob-1');
    });
    expect(mero.admin.getBlobInfo).toHaveBeenCalledWith('blob-1', { contextId: 'ctx-1' });
  });

  it('accepts a peer-sourced answer with no hash and no mimeType', async () => {
    // A probe carries presence and size only — absent hash/mimeType is a valid
    // result, not a malformed one.
    const mero = createMero({
      getBlobInfo: vi.fn().mockResolvedValue({ blobId: 'blob-1', size: 262144000, source: 'peer' }),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobInfo('blob-1', { contextId: 'ctx-1' }));

    await waitFor(() => {
      expect(result.current.info).not.toBeNull();
    });
    expect(result.current.info).toEqual({ blobId: 'blob-1', size: 262144000, source: 'peer' });
    expect(result.current.info?.hash).toBeUndefined();
    expect(result.current.info?.mimeType).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('surfaces a 404 as notFound without swallowing the error', async () => {
    const mero = createMero({
      getBlobInfo: vi.fn().mockRejectedValue(httpError(404, 'not found')),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobInfo('blob-1', { contextId: 'ctx-1' }));

    await waitFor(() => {
      expect(result.current.error?.message).toBe('not found');
    });
    expect(result.current.notFound).toBe(true);
    expect(result.current.info).toBeNull();
  });

  it('does not label a transport failure as notFound', async () => {
    const mero = createMero({
      getBlobInfo: vi.fn().mockRejectedValue(new Error('network down')),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobInfo('blob-1'));

    await waitFor(() => {
      expect(result.current.error?.message).toBe('network down');
    });
    expect(result.current.notFound).toBe(false);
  });
});

describe('useBlobUrl', () => {
  it('does not fetch when blobId is null', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobUrl(null));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mero.admin.getBlob).not.toHaveBeenCalled();
    expect(result.current.url).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('yields an object URL for the fetched bytes', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobUrl('blob-1', { contextId: 'ctx-1' }));

    await waitFor(() => {
      expect(result.current.url).toBe('blob:mock/1');
    });
    expect(mero.admin.getBlob).toHaveBeenCalledWith('blob-1', { contextId: 'ctx-1' });
    expect(result.current.loading).toBe(false);
  });

  it('revokes the object URL on unmount', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, unmount } = renderHook(() => useBlobUrl('blob-1'));

    await waitFor(() => {
      expect(result.current.url).toBe('blob:mock/1');
    });

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock/1');
  });

  it('revokes the old URL and clears it when the blobId changes', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(({ id }) => useBlobUrl(id), {
      initialProps: { id: 'blob-1' as string | null },
    });

    await waitFor(() => {
      expect(result.current.url).toBe('blob:mock/1');
    });

    rerender({ id: 'blob-2' });

    // The previous URL is revoked and dropped straight away — a revoked URL is
    // never handed out as the current one.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock/1');
    expect(result.current.url).not.toBe('blob:mock/1');

    await waitFor(() => {
      expect(result.current.url).toBe('blob:mock/2');
    });
  });

  it('drops a stale response that lands after the blobId changed', async () => {
    const resolvers: Record<string, (value: ArrayBuffer) => void> = {};
    const getBlob = vi.fn(
      (blobId: string) =>
        new Promise<ArrayBuffer>((resolve) => {
          resolvers[blobId] = resolve;
        }),
    );
    const mero = createMero({ getBlob });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(({ id }) => useBlobUrl(id), {
      initialProps: { id: 'blob-1' as string | null },
    });

    await waitFor(() => {
      expect(getBlob).toHaveBeenCalledWith('blob-1', undefined);
    });

    rerender({ id: 'blob-2' });
    await waitFor(() => {
      expect(getBlob).toHaveBeenCalledWith('blob-2', undefined);
    });

    // The newer request answers first, then the superseded one arrives.
    resolvers['blob-2'](new ArrayBuffer(2));
    await waitFor(() => {
      expect(result.current.url).toBe('blob:mock/1');
    });

    resolvers['blob-1'](new ArrayBuffer(1));
    await Promise.resolve();
    await Promise.resolve();

    // The loser never even allocated a URL, so nothing leaked and nothing
    // overwrote the winner.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(result.current.url).toBe('blob:mock/1');
  });

  it('surfaces a 404 as notFound and leaves no URL', async () => {
    const mero = createMero({
      getBlob: vi.fn().mockRejectedValue(httpError(404)),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useBlobUrl('blob-1', { contextId: 'ctx-1' }));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.notFound).toBe(true);
    expect(result.current.url).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('useUploadBlob', () => {
  it('uploads bytes and returns the blob id', async () => {
    const mero = createMero();
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useUploadBlob());

    const data = new Uint8Array([1, 2, 3]);
    const uploaded = await result.current.uploadBlob({ data, contextId: 'ctx-1' });

    expect(uploaded).toEqual({ blobId: 'blob-1', size: 10 });
    expect(mero.admin.uploadBlob).toHaveBeenCalledWith({ data, contextId: 'ctx-1' });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeNull();
  });

  it('reports an upload failure instead of throwing', async () => {
    const mero = createMero({
      uploadBlob: vi.fn().mockRejectedValue(new Error('upload boom')),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useUploadBlob());

    const uploaded = await result.current.uploadBlob({ data: new Uint8Array([1]) });

    expect(uploaded).toBeNull();
    await waitFor(() => {
      expect(result.current.error?.message).toBe('upload boom');
    });
  });

  it('returns null when there is no client', async () => {
    mockUseMero.mockReturnValue({ mero: null } as never);

    const { result } = renderHook(() => useUploadBlob());

    await expect(result.current.uploadBlob({ data: new Uint8Array([1]) })).resolves.toBeNull();
  });
});
