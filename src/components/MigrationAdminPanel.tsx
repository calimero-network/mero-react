import { useMigrationStatus } from '../hooks';

export interface MigrationAdminPanelProps {
  /** Namespace whose migration rollup to display. */
  namespaceId: string;
  /** Re-fetch interval; migration facts arrive via heartbeat gossip. */
  pollIntervalMs?: number;
  className?: string;
}

/**
 * Operator view of a namespace's migration rollup (skew #3): the cohort
 * counters, `membersPendingSignature`, and a per-member table. Read-only —
 * pair with the upgrade-trigger hooks to drive a migration.
 */
export function MigrationAdminPanel({ namespaceId, pollIntervalMs, className }: MigrationAdminPanelProps) {
  const { status, rollup, members, membersPendingSignature, loading } = useMigrationStatus(
    namespaceId,
    { pollIntervalMs },
  );

  if (loading && !status) {
    return <div className={className} data-testid="migration-admin-panel">Loading migration status…</div>;
  }

  if (!status || !rollup) {
    return <div className={className} data-testid="migration-admin-panel">No migration status available.</div>;
  }

  return (
    <div className={className} data-testid="migration-admin-panel">
      <dl>
        <div><dt>Target version</dt><dd>{status.targetVersion}</dd></div>
        <div><dt>Migrated</dt><dd>{rollup.migrated}</dd></div>
        <div><dt>In progress</dt><dd>{rollup.inProgress}</dd></div>
        <div><dt>Unknown</dt><dd>{rollup.unknown}</dd></div>
        <div><dt>Total</dt><dd>{rollup.total}</dd></div>
        <div><dt>All migrated</dt><dd>{rollup.allMigrated ? 'yes' : 'no'}</dd></div>
        <div>
          <dt>Members pending signature</dt>
          <dd data-testid="members-pending-signature">{membersPendingSignature}</dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr><th>Peer</th><th>State</th><th>Schema</th><th>Pending</th></tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.peer} data-testid="migration-member-row">
              <td>{m.peer}</td>
              <td>{m.state}</td>
              <td>{m.report?.schemaVersion ?? '—'}</td>
              <td>{m.report?.authoredRemaining ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
