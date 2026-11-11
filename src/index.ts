/**
 * mero-react: React bindings for the Calimero 1.0 client (mero-js
 * `CalimeroClient`).
 *
 * @packageDocumentation
 */

// Component styles: bundled and injected as a <style> at runtime by tsup
// (`injectStyle: true`), so consumers need no CSS import.
import './components/styles.css';

// Provider
export { MeroProvider, useMero, MeroContext } from './context';
export type { MeroProviderProps } from './context';
export type { MeroContextValue, MeroProviderConfig } from './types';
export { resolvePolicy, reportSessions, SessionReportingClient } from './client';
export type { PolicyOptions } from './client';

// Errors
export { describeError, isLoginRequired } from './errors';
export type { Failure, FailureKind } from './errors';

// Hooks
export * from './hooks';
// mero-js now exports a `CallOptions` too (a generated method's per-call
// `{ confirm, operatorProof, signal }`); mero-react's own (`useApp().call`'s)
// keeps the name, and mero-js's is here as `RouteCallOptions`.
export type { CallOptions } from './hooks';
export type { CallOptions as RouteCallOptions } from '@calimero-network/mero-js';

// Components
export { ConnectButton, LoginModal, CalimeroLogo, shortAccount } from './components';
export type { ConnectButtonProps, LoginModalProps, LoginModalTab, CalimeroLogoProps } from './components';

// Theme
export { MERO_CSS_VARS, cssVar, defaultMeroTheme, resolveMeroTheme, themeToCssVars } from './theme';
export type { MeroTheme, ResolvedMeroTheme } from './theme';

// Storage
export {
  localStorageSessionStore,
  memorySessionStore,
  getNodeUrl,
  setNodeUrl,
  clearNodeUrl,
  getCluster,
  setCluster,
  clearCluster,
  getAppId,
  setAppId,
  clearAppId,
  clearAllStorage,
} from './storage';
export type { SessionStore } from './storage';

// mero-js, so apps need one import: CalimeroClient, the typed errors
// (AppError, ConfirmRequired, WrongNode, DirectoryError, ...), browserPasskey,
// the consent request builders (releaseConsent, upgradeConsent, consentReturn),
// confirmationCode, ORG_CAPABILITIES, DEFAULT_DIRECTORY.
// mero-react's own `Codec` (presence) wins over the export * below.
export * from '@calimero-network/mero-js';
