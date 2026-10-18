import { describe, expect, it } from 'vitest';
import { describeInviteFailure } from './describeInviteFailure';

describe('describeInviteFailure', () => {
  // A link used once and a removal used to read the same as any refusal: "you
  // can't join with this invitation". They ask different things of a person.
  it('tells a used link, a removal and a refusal apart', () => {
    const used = describeInviteFailure('already-used');
    const removed = describeInviteFailure('removed');
    const refused = describeInviteFailure('refused');

    expect(used).toBe("You've already used this link to join this team once. Ask an admin for a new link.");
    expect(removed).toMatch(/An admin removed you from this team/);
    expect(new Set([used, removed, refused]).size).toBe(3);
  });

  it("names the app's own noun", () => {
    expect(describeInviteFailure('removed', 'vault')).toMatch(/removed you from this vault/);
  });

  it("leaves an unknown failure to the node's own message", () => {
    expect(describeInviteFailure('unknown')).toBeNull();
  });
});
