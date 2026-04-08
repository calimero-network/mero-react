/**
 * mero-react - React bindings for MeroJs
 *
 * @packageDocumentation
 */

// Context & Provider
export { MeroProvider, useMero, MeroContext } from './context';
export type { MeroProviderProps } from './context';

// Components
export { ConnectButton } from './components';
export type { ConnectButtonProps } from './components';
export { LoginModal } from './components';
export type { LoginModalProps } from './components';

// Hooks
export {
  useApplicationContexts,
  useContextDiscovery,
  useContextGroup,
  useContexts,
  useCreateContext,
  useCreateGroupInNamespace,
  useCreateNamespace,
  useCreateNamespaceInvitation,
  useDeleteContext,
  useDeleteGroup,
  useDeleteNamespace,
  useDetachContextFromGroup,
  useExecute,
  useGroupCapabilities,
  useGroupContexts,
  useGroupInfo,
  useGroupInvitations,
  useGroupMembers,
  useGroupUpgradeStatus,
  useJoinContext,
  useJoinGroup,
  useJoinNamespace,
  useNamespace,
  useNamespaceGroups,
  useNamespaceIdentity,
  useNamespaces,
  useNamespacesForApplication,
  useNestGroup,
  useRegisterGroupSigningKey,
  useRetryGroupUpgrade,
  useSetDefaultCapabilities,
  useSetDefaultVisibility,
  useSetGroupAlias,
  useSetMemberAlias,
  useSetTeeAdmissionPolicy,
  useSubgroups,
  useUnnestGroup,
  useUpdateGroupSettings,
  useUpdateMemberRole,
  useUpgradeGroup,
  useAddGroupMembers,
  useRemoveGroupMembers,
  useSubscription,
  useSyncGroup,
} from './hooks';

// Types
export {
  AppMode,
  ConnectionType,
} from './types';
export type {
  AppContext,
  ApplicationContextRecord,
  ContextDiscoveryOptions,
  ContextDiscoveryState,
  CustomConnectionConfig,
  ExecutionResult,
  MeroContextValue,
  MeroProviderConfig,
} from './types';

// Storage utilities
export {
  localStorageTokenStorage,
  getNodeUrl,
  setNodeUrl,
  clearNodeUrl,
  getApplicationId,
  setApplicationId,
  clearApplicationId,
  getContextId,
  setContextId,
  clearContextId,
  getContextIdentity,
  setContextIdentity,
  clearContextIdentity,
  clearAllStorage,
} from './storage';

// Re-export everything from mero-js so apps only need one import
export * from '@calimero-network/mero-js';
