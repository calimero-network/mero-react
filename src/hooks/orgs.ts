/**
 * Organizations (was: namespaces) and teams (was: groups).
 *
 * An organization holds members (guest, member, admin, owner), teams and the
 * apps it owns. A team is a set of an org's members, optionally nested under
 * another team, joined by anyone in the org (`everyone`) or by invite only.
 */

import { useCallback } from 'react';
import type { OrgInfo } from '@calimero-network/mero-js';
import { useMero } from '../context';
import { useClientAction, useResource, useSignedInClient, type MutationOptions } from './internal';

export type OrgRole = 'guest' | 'member' | 'admin' | 'owner';
export type TeamJoin = 'everyone' | 'invite';
export type TeamRole = 'lead' | 'member' | 'readOnly';

// ---------------------------------------------------------------- organizations

/** An organization: members, teams, metadata, release approvers. Was `useNamespace`. */
export function useOrg(orgId?: string | null) {
  const client = useSignedInClient();
  return useResource<OrgInfo | null>(client && orgId ? () => client.getOrg(orgId) : null, null, [client, orgId]);
}

/** Create an organization; resolves its id. Was `useCreateNamespace`. */
export function useCreateOrg(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const create = useCallback((name: string) => withClient((c) => c.createOrg(name)), [withClient]);
  return { create, ...state };
}

/** Delete an organization (asks for the passkey). Was `useDeleteNamespace`. */
export function useDeleteOrg(options?: MutationOptions) {
  const { passkey } = useMero();
  const { withClient, ...state } = useClientAction(options);
  const deleteOrg = useCallback(
    (orgId: string) =>
      withClient(async (c) => {
        await c.deleteOrg(orgId, passkey);
        return true;
      }),
    [withClient, passkey],
  );
  return { deleteOrg, ...state };
}

/**
 * Add a member or change their role. Was `useUpdateMemberRole` and, at the org
 * level, `useAddGroupMembers`.
 */
export function useSetMember(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const setMember = useCallback(
    (orgId: string, account: string, role: OrgRole) =>
      withClient(async (c) => {
        await c.setMember(orgId, account, role);
        return true;
      }),
    [withClient],
  );
  return { setMember, ...state };
}

/** Remove a member from an organization. */
export function useRemoveMember(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const removeMember = useCallback(
    (orgId: string, account: string) => withClient((c) => c.removeMember(orgId, account)),
    [withClient],
  );
  return { removeMember, ...state };
}

/** Set an organization's metadata. Was `useSetGroupMetadata` on a namespace root. */
export function useSetOrgMetadata(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const setMetadata = useCallback(
    (orgId: string, metadata: unknown) =>
      withClient(async (c) => {
        await c.setOrgMetadata(orgId, metadata);
        return true;
      }),
    [withClient],
  );
  return { setMetadata, ...state };
}

/** Set a member's metadata (a display name, say). Same name as before; now per org. */
export function useSetMemberMetadata(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const setMetadata = useCallback(
    (orgId: string, account: string, metadata: unknown) =>
      withClient(async (c) => {
        await c.setMemberMetadata(orgId, account, metadata);
        return true;
      }),
    [withClient],
  );
  return { setMetadata, ...state };
}

/**
 * Set capability bits (`ORG_CAPABILITIES`) for an account or a team, or the
 * org's default with neither. Was `useSetDefaultCapabilities`.
 */
export function useSetCapabilities(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const setCapabilities = useCallback(
    (orgId: string, capabilities: number, at: { account?: string; team?: string } = {}) =>
      withClient(async (c) => {
        await c.setCapabilities(orgId, capabilities, at);
        return true;
      }),
    [withClient],
  );
  return { setCapabilities, ...state };
}

// ---------------------------------------------------------------- teams

/** A team of an organization. Was `useGroupInfo`. */
export function useTeam(orgId?: string | null, teamId?: string | null) {
  const client = useSignedInClient();
  return useResource<Record<string, unknown> | null>(
    client && orgId && teamId ? () => client.getTeam(orgId, teamId) : null,
    null,
    [client, orgId, teamId],
  );
}

export interface CreateTeamInput {
  orgId: string;
  name: string;
  join?: TeamJoin;
  /** The team it sits under. */
  parent?: string;
}

/** Create a team; resolves its id. Was `useCreateGroupInNamespace`. */
export function useCreateTeam(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const create = useCallback(
    ({ orgId, name, join = 'invite', parent }: CreateTeamInput) => withClient((c) => c.createTeam(orgId, name, join, parent)),
    [withClient],
  );
  return { create, ...state };
}

export interface TeamUpdate {
  name?: string;
  join?: TeamJoin;
  /** Move it under another team; `null` makes it top-level. */
  parent?: string | null;
  metadata?: unknown;
}

/**
 * Rename, re-parent, change who may join, or set metadata. Was
 * `useSetGroupMetadata`, `useReparentGroup` and `useSetSubgroupVisibility`.
 */
export function useUpdateTeam(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const update = useCallback(
    (orgId: string, teamId: string, change: TeamUpdate) =>
      withClient(async (c) => {
        await c.updateTeam(orgId, teamId, change);
        return true;
      }),
    [withClient],
  );
  return { update, ...state };
}

/** Delete a team. Was `useDeleteGroup`. */
export function useDeleteTeam(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const deleteTeam = useCallback(
    (orgId: string, teamId: string) =>
      withClient(async (c) => {
        await c.deleteTeam(orgId, teamId);
        return true;
      }),
    [withClient],
  );
  return { deleteTeam, ...state };
}

/** Add an org member to a team, or change their row. Was `useAddGroupMembers`. */
export function useSetTeamMember(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const setTeamMember = useCallback(
    (
      orgId: string,
      teamId: string,
      account: string,
      row: { role?: TeamRole; lead?: boolean; capabilities?: number } = {},
    ) =>
      withClient(async (c) => {
        await c.setTeamMember(orgId, teamId, account, row);
        return true;
      }),
    [withClient],
  );
  return { setTeamMember, ...state };
}

/** Remove someone from a team. Was `useRemoveGroupMembers`. */
export function useRemoveTeamMember(options?: MutationOptions) {
  const { withClient, ...state } = useClientAction(options);
  const removeTeamMember = useCallback(
    (orgId: string, teamId: string, account: string) =>
      withClient(async (c) => {
        await c.removeTeamMember(orgId, teamId, account);
        return true;
      }),
    [withClient],
  );
  return { removeTeamMember, ...state };
}
