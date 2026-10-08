/**
 * The package entry exposes the login grant set, so the tools that mint a
 * token for an app (tauri-app, admin-dashboard, auth-frontend) can assert
 * against it instead of keeping a copy that drifts.
 */
import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('package entry', () => {
  it('exports getPermissionsForMode', () => {
    expect(typeof entry.getPermissionsForMode).toBe('function');
  });

  it('a MultiContext app may delete the contexts it may create', () => {
    const grants = entry.getPermissionsForMode(entry.AppMode.MultiContext);
    expect(grants).toContain('context:create');
    expect(grants).toContain('context:delete');
  });
});
