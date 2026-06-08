// @vitest-environment jsdom

import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MigrationPendingBanner } from './MigrationPendingBanner';
import { useMero } from '../context';

vi.mock('../context', () => ({ useMero: vi.fn() }));
const mockUseMero = vi.mocked(useMero);

afterEach(cleanup);

function meroWith(rpc: Record<string, unknown>) {
  return { rpc, admin: {}, events: {} };
}

describe('MigrationPendingBanner', () => {
  it('renders nothing when no entries are pending', async () => {
    const mero = meroWith({ countMyPending: vi.fn().mockResolvedValue(0) });
    mockUseMero.mockReturnValue({ mero } as never);

    render(<MigrationPendingBanner contextId="ctx1" />);

    await waitFor(() => {
      expect(screen.queryByTestId('migration-pending-banner')).toBeNull();
    });
  });

  it('shows the convert button and migrates on click', async () => {
    const migrateMyEntries = vi.fn().mockResolvedValue({ converted: 2, remaining: 0 });
    const mero = meroWith({
      countMyPending: vi.fn().mockResolvedValue(2),
      migrateMyEntries,
    });
    mockUseMero.mockReturnValue({ mero } as never);
    const onMigrated = vi.fn();

    render(<MigrationPendingBanner contextId="ctx1" onMigrated={onMigrated} />);

    const button = await screen.findByRole('button');
    fireEvent.click(button);

    await waitFor(() => expect(migrateMyEntries).toHaveBeenCalledWith('ctx1'));
    await waitFor(() => expect(onMigrated).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('migration-pending-banner')).toBeNull());
  });
});
