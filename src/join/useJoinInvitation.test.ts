import { describe, expect, it } from 'vitest';
import { isFinalInvitationError } from './useJoinInvitation';

describe('isFinalInvitationError', () => {
  it('treats a failure about the invitation itself as final', () => {
    expect(isFinalInvitationError('HTTP 400: invitation expired')).toBe(true);
    expect(isFinalInvitationError('Invalid Signature on the invitation')).toBe(true);
    expect(isFinalInvitationError('already a member of this namespace')).toBe(true);
  });

  it('keeps the invitation for anything transient or unfamiliar', () => {
    expect(isFinalInvitationError(undefined)).toBe(false);
    expect(isFinalInvitationError('HTTP 504: could not reach any member')).toBe(false);
    // "invalid" alone is a proxy's word too, not the invitation's.
    expect(isFinalInvitationError('502 invalid response from upstream')).toBe(false);
  });
});
