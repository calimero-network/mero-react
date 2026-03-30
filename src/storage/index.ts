/**
 * Storage utilities for mero-react
 * 
 * Provides localStorage-based token storage and other persistence utilities.
 */

import type { TokenData } from '@calimero-network/mero-js';

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'mero:access_token',
  REFRESH_TOKEN: 'mero:refresh_token',
  EXPIRES_AT: 'mero:expires_at',
  NODE_URL: 'mero:node_url',
  APPLICATION_ID: 'mero:application_id',
  CONTEXT_ID: 'mero:context_id',
  CONTEXT_IDENTITY: 'mero:context_identity',
} as const;

let _storageAvailable: boolean | null = null;

function isLocalStorageAvailable(): boolean {
  if (_storageAvailable !== null) return _storageAvailable;
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      _storageAvailable = false;
      return false;
    }
    const testKey = '__mero_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    _storageAvailable = true;
  } catch {
    _storageAvailable = false;
  }
  return _storageAvailable;
}

export const localStorageTokenStorage = {
  async get(): Promise<TokenData | null> {
    if (!isLocalStorageAvailable()) {
      return null;
    }

    try {
      const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const expiresAt = localStorage.getItem(STORAGE_KEYS.EXPIRES_AT);

      if (!accessToken || !refreshToken) {
        return null;
      }

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600000,
      };
    } catch (e) {
      console.error('[mero-react] Failed to get token from storage:', e);
      return null;
    }
  },

  async set(token: TokenData): Promise<void> {
    if (!isLocalStorageAvailable()) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token.access_token);
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, token.refresh_token);
      localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, token.expires_at.toString());
    } catch (e) {
      console.error('[mero-react] Failed to save token to storage:', e);
    }
  },

  async clear(): Promise<void> {
    if (!isLocalStorageAvailable()) {
      return;
    }

    try {
      localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
    } catch (e) {
      console.error('[mero-react] Failed to clear token from storage:', e);
    }
  },
};

/**
 * Get the stored node URL
 */
export function getNodeUrl(): string | null {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.NODE_URL);
}

/**
 * Set the node URL
 */
export function setNodeUrl(url: string): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.NODE_URL, url);
}

/**
 * Clear the node URL
 */
export function clearNodeUrl(): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.NODE_URL);
}

/**
 * Get the stored application ID
 */
export function getApplicationId(): string | null {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.APPLICATION_ID);
}

/**
 * Set the application ID
 */
export function setApplicationId(id: string): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.APPLICATION_ID, id);
}

/**
 * Clear the application ID
 */
export function clearApplicationId(): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.APPLICATION_ID);
}

/**
 * Get the stored context ID
 */
export function getContextId(): string | null {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.CONTEXT_ID);
}

/**
 * Set the context ID
 */
export function setContextId(id: string): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.CONTEXT_ID, id);
}

/**
 * Clear the context ID
 */
export function clearContextId(): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.CONTEXT_ID);
}

/**
 * Get the stored context identity
 */
export function getContextIdentity(): string | null {
  if (!isLocalStorageAvailable()) return null;
  return localStorage.getItem(STORAGE_KEYS.CONTEXT_IDENTITY);
}

/**
 * Set the context identity
 */
export function setContextIdentity(id: string): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.setItem(STORAGE_KEYS.CONTEXT_IDENTITY, id);
}

/**
 * Clear the context identity
 */
export function clearContextIdentity(): void {
  if (!isLocalStorageAvailable()) return;
  localStorage.removeItem(STORAGE_KEYS.CONTEXT_IDENTITY);
}

/**
 * Clear all mero-react storage
 */
export function clearAllStorage(): void {
  if (!isLocalStorageAvailable()) return;
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}
