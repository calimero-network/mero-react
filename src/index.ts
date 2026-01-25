/**
 * mero-react - React bindings for MeroJs
 * 
 * @packageDocumentation
 */

// Context & Provider
export { MeroProvider, useMero, MeroContext } from './context';
export type { MeroProviderProps } from './context';

// Components
export { ConnectButton, LoginModal } from './components';
export type { ConnectButtonProps, LoginModalProps } from './components';

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
  clearAllStorage,
} from './storage';

// Re-export MeroJs for convenience
export { MeroJs } from '@calimero-network/mero-js';
export type { TokenStorage, TokenData } from '@calimero-network/mero-js';
