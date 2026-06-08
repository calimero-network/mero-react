import React from 'react';
import { useMyAuthoredMigration } from '../hooks';

export interface MigrationPendingBannerProps {
  /** Context whose authored entries to check / convert. */
  contextId: string;
  className?: string;
  /** Override the default prompt text. */
  children?: React.ReactNode;
  /** Fired once a convert leaves nothing pending (`remaining === 0`). */
  onMigrated?: () => void;
}

/**
 * Shows only when the current identity has entries below the target schema
 * (skew #1). A single button runs the one-tap `migrate_my_entries` convert and
 * the banner clears itself once nothing is pending.
 */
export function MigrationPendingBanner({
  contextId,
  className,
  children,
  onMigrated,
}: MigrationPendingBannerProps) {
  const { pending, pendingCount, authorize, loading } = useMyAuthoredMigration(contextId);

  if (!pending) return null;

  const handleClick = async () => {
    const result = await authorize();
    if (result && result.remaining === 0) {
      onMigrated?.();
    }
  };

  const message =
    children ??
    `You have ${pendingCount} ${pendingCount === 1 ? 'entry' : 'entries'} to re-sign after a recent upgrade.`;

  return (
    <div className={className} data-testid="migration-pending-banner" role="status">
      <span>{message}</span>
      <button type="button" onClick={handleClick} disabled={loading}>
        {loading ? 'Migrating…' : 'Migrate my data'}
      </button>
    </div>
  );
}
