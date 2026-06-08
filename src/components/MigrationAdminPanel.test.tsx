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
      expectedMembers: 3,
      rollup: { migrated: 2, inProgress: 0, unknown: 1, total: 3, allMigrated: false, membersPendingSignature: 1 },
      members: [
        { peer: 'aa', report: { schemaVersion: 2, residueAuto: 0, residueIdentity: 0, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 0 }, state: 'migrated' },
        { peer: 'bb', report: { schemaVersion: 1, residueAuto: 0, residueIdentity: 0, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 2 }, state: 'in_progress' },
        { peer: 'cc', report: null, state: 'unknown' },
      ],
    });
    const mero = { admin: { getMigrationStatus }, rpc: {}, events: {} };
    mockUseMero.mockReturnValue({ mero } as never);

    render(<MigrationAdminPanel namespaceId="ns1" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('migration-member-row')).toHaveLength(3);
    });
    expect(screen.getByTestId('members-pending-signature').textContent).toContain('1');
    expect(getMigrationStatus).toHaveBeenCalledWith('ns1');
  });
});
