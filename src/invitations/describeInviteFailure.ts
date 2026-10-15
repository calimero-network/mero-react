import type { InviteFailureReason } from '@calimero-network/mero-js';

/**
 * What to tell a person about a failed join, or `null` to show the node's own
 * message (an `unknown` failure has nothing better to offer).
 *
 * `noun` is what the app calls the thing being joined: "team", "space", "vault".
 * The reason is mero-js's (`redeemInvitation`), read off the node's status.
 */
export function describeInviteFailure(
  reason: InviteFailureReason,
  noun = 'team',
): string | null {
  switch (reason) {
    case 'expired':
      return 'This invitation has expired. Ask for a new link.';
    case 'invalid':
      return "This invitation link isn't valid. Ask for a new one.";
    case 'refused':
      return `You can't join this ${noun} with this invitation. Ask an admin to invite you again.`;
    case 'signed-out':
      return 'Your session with your node has ended. Sign in again to finish joining.';
    case 'no-one-online':
      return `No one in this ${noun} is online to let you in yet. It will try again the next time you open the app.`;
    case 'node-unreachable':
      return "Couldn't reach your node. Check that it is running, then try again.";
    case 'unknown':
      return null;
  }
}
