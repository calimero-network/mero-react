/**
 * mero-react - React bindings for MeroJs
 *
 * @packageDocumentation
 */

// Context & Provider
export { MeroProvider, useMero, MeroContext } from './context';
export type { MeroProviderProps } from './context';

// Hooks
export { useExecute, useSubscription, useContexts } from './hooks';

// Types
export {
  AppMode,
  ConnectionType,
  EventStreamMode,
} from './types';
export type {
  MeroContextValue,
  MeroProviderConfig,
  CustomConnectionConfig,
  AppContext,
  ExecutionResult,
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
