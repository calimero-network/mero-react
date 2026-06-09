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
  const { status, rollup, members, membersPendingSignature, failed, error } = useMigrationStatus(
    namespaceId,
    { pollIntervalMs },
  );

  // Surface a real failure rather than the misleading "no status" message.
  if (error && !status) {
    return (
      <div className={className} data-testid="migration-admin-panel">
        Failed to load migration status: {error.message}
      </div>
    );
  }

  // Before the first successful fetch (initial paint or in-flight), show
  // loading — a successful read always yields a rollup, so a null status here
  // means "not loaded yet", never "empty".
  if (!status || !rollup) {
    return <div className={className} data-testid="migration-admin-panel">Loading migration status…</div>;
  }

  return (
    <div className={className} data-testid="migration-admin-panel">
      {error && (
        // A poll failed after data was already loaded — keep showing the last
        // good rollup but flag that it may be stale.
        <div data-testid="migration-status-error" role="alert">
          Could not refresh migration status: {error.message}
        </div>
      )}
      <dl>
        <div><dt>Target version</dt><dd>{status.targetVersion}</dd></div>
        <div><dt>Migrated</dt><dd>{rollup.migrated}</dd></div>
        <div><dt>In progress</dt><dd>{rollup.inProgress}</dd></div>
        <div><dt>Unknown</dt><dd>{rollup.unknown}</dd></div>
        <div><dt>Failed</dt><dd data-testid="migration-failed-count">{failed}</dd></div>
        <div><dt>Total</dt><dd>{rollup.total}</dd></div>
        <div><dt>All migrated</dt><dd>{rollup.allMigrated ? 'yes' : 'no'}</dd></div>
        <div>
          <dt>Members pending signature</dt>
          <dd data-testid="members-pending-signature">{membersPendingSignature}</dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr><th>Peer</th><th>State</th><th>Schema</th><th>Pending</th><th>Reason</th></tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.peer} data-testid="migration-member-row">
              <td>{m.peer}</td>
              <td>{m.state}</td>
              <td>{m.report?.schemaVersion ?? '—'}</td>
              <td>{m.report?.authoredRemaining ?? '—'}</td>
              <td>{m.report?.migrationFailed ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
