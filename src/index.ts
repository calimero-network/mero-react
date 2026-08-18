/**
 * mero-react - React bindings for MeroJs
 *
 * @packageDocumentation
 */

// Component styles — bundled and injected as <style> at runtime by tsup
// (see `injectStyle: true` in tsup.config.ts), so consumers don't need a
// separate CSS import.
import './components/styles.css';

// Context & Provider
export { MeroProvider, useMero, MeroContext } from './context';
export type { MeroProviderProps } from './context';

// Components
export { ConnectButton } from './components';
export type { ConnectButtonProps } from './components';
export { LoginModal } from './components';
export type { LoginModalProps } from './components';
export { CalimeroLogo } from './components';
export type { CalimeroLogoProps } from './components';
export { MigrationPendingBanner } from './components';
export type { MigrationPendingBannerProps } from './components';
export { MigrationAdminPanel } from './components';
export type { MigrationAdminPanelProps } from './components';

// Local-node discovery
export {
  discoverLocalNodes,
  probeNodeHealth,
  localNodeUrl,
  nodeEndpoint,
  DEFAULT_LOCAL_NODE_PORTS,
} from '@calimero-network/mero-js';
export type { DiscoverLocalNodesOptions } from '@calimero-network/mero-js';

// Theme
export {
  MERO_CSS_VARS,
  cssVar,
  defaultMeroTheme,
  resolveMeroTheme,
  themeToCssVars,
} from './theme';
export type { MeroTheme, ResolvedMeroTheme } from './theme';

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
  useDefaultCapabilities,
  useDeleteContext,
  useDeleteGroup,
  useDeleteNamespace,
  useDetachContextFromGroup,
  useEphemeral,
  useExecute,
  useGroupCapabilities,
  useGroupContexts,
  useGroupInfo,
  useGroupInvitations,
  useGroupMembers,
  useGroupMetadata,
  useGroupUpgradeStatus,
  useJoinContext,
  useJoinGroup,
  useJoinNamespace,
  useJoinSubgroupInheritance,
  useMemberMetadata,
  useNamespace,
  useNamespaceGroups,
  useMigrationEvents,
  useNamespaceIdentity,
  useNodeIdentity,
  useNamespaces,
  useNamespacesForApplication,
  useRetryGroupUpgrade,
  useSetContextMetadata,
  useSetDefaultCapabilities,
  useSetGroupMetadata,
  useSetMemberMetadata,
  useSetSubgroupVisibility,
  useSetTeeAdmissionPolicy,
  useReparentGroup,
  useSubgroups,
  useSubgroupVisibility,
  useUpdateMemberRole,
  useUpgradeGroup,
  useResyncContext,
  useAddGroupMembers,
  useRemoveGroupMembers,
  useSubscription,
  useSyncGroup,
  useMigrationStatus,
  useAppVersion,
  useLatestVersion,
  useGroupAppVersion,
  useInstallFromRegistry,
  useMyAuthoredMigration,
} from './hooks';
export type {
  SetMetadataInput,
  SubscriptionInput,
  SubscriptionEventData,
  Codec,
  EphemeralClient,
  EphemeralEntry,
  UseEphemeralOptions,
  UseEphemeralResult,
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
  getTokenNodeUrl,
  setTokenNodeUrl,
  clearTokenNodeUrl,
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

// Explicit re-exports of the capability helpers / metadata types. These already
// flow through the `export *` above, but are listed here so the public surface
// of this package is self-documenting.
export { CAPABILITIES, hasCap, withCap, withoutCap } from '@calimero-network/mero-js';
export type { MetadataRecord } from '@calimero-network/mero-js';
