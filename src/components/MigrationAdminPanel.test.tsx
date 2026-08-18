// @vitest-environment jsdom

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MigrationAdminPanel } from './MigrationAdminPanel';
import { useMero } from '../context';

vi.mock('../context', () => ({ useMero: vi.fn() }));
const mockUseMero = vi.mocked(useMero);

afterEach(cleanup);

describe('MigrationAdminPanel', () => {
  it('renders the rollup counters and one row per member', async () => {
    const getMigrationStatus = vi.fn().mockResolvedValue({
      targetVersion: 2,
      expectedMembers: 4,
      rollup: { migrated: 2, inProgress: 0, unknown: 1, failed: 1, total: 4, allMigrated: false, membersPendingSignature: 1 },
      members: [
        { peer: 'aa', report: { schemaVersion: 2, residueAuto: 0, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 0 }, state: 'migrated' },
        { peer: 'bb', report: { schemaVersion: 1, residueAuto: 0, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 2 }, state: 'in_progress' },
        { peer: 'cc', report: null, state: 'unknown' },
        { peer: 'dd', report: { schemaVersion: 1, residueAuto: 1, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 0, migrationFailed: 'check_aborted' }, state: 'failed' },
      ],
    });
    const mero = {
      admin: { getMigrationStatus },
      rpc: {},
      events: {
        onMigrationEvent: vi.fn(() => () => {}),
        connect: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockUseMero.mockReturnValue({ mero } as never);

    render(<MigrationAdminPanel namespaceId="ns1" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('migration-member-row')).toHaveLength(4);
    });
    expect(screen.getByTestId('members-pending-signature').textContent).toContain('1');
    // The failed-state surface: rollup counter + the per-member reason.
    expect(screen.getByTestId('migration-failed-count').textContent).toContain('1');
    expect(screen.getByText('check_aborted')).toBeTruthy();
    expect(getMigrationStatus).toHaveBeenCalledWith('ns1');
  });
});
