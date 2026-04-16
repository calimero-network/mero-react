# @calimero-network/mero-react

React bindings for [@calimero-network/mero-js](../mero-js) — the Calimero Network SDK.

No external UI framework. No styled-components. No axios. A provider, 44 hooks, storage helpers, and optional headless utility components (ConnectButton, LoginModal).

## Installation

```bash
pnpm add @calimero-network/mero-react
```

Peer dependencies: `react` ^18 || ^19, `react-dom` ^18 || ^19. `mero-js` is a bundled dependency — no separate install needed.

## Quick start

```tsx
import { MeroProvider, useMero, useExecute, useSubscription, AppMode } from '@calimero-network/mero-react';

function App() {
  return (
    <MeroProvider mode={AppMode.SingleContext} packageName="com.calimero.my-app">
      <MyApp />
    </MeroProvider>
  );
}

function MyApp() {
  const { isAuthenticated, connectToNode, logout, contextId, contextIdentity } = useMero();

  if (!isAuthenticated) {
    return <button onClick={() => connectToNode('http://localhost:4001')}>Connect</button>;
  }

  return <Dashboard />;
}

function Dashboard() {
  const { contextId, contextIdentity } = useMero();
  const { execute, loading } = useExecute(contextId, contextIdentity);
  const [items, setItems] = useState([]);

  // Real-time updates via SSE
  useSubscription(
    contextId ? [contextId] : [],
    () => fetchItems(),
  );

  const fetchItems = async () => {
    const data = await execute('list');
    if (data) setItems(data);
  };

  const addItem = async (title: string) => {
    await execute('add', { title });
    await fetchItems();
  };

  return (
    <div>
      {loading && <p>Loading...</p>}
      {items.map(item => <div key={item.id}>{item.title}</div>)}
      <button onClick={() => addItem('New item')}>Add</button>
    </div>
  );
}
```

## API reference

### `<MeroProvider>`

Wraps your app with a MeroJs instance, auth state, and SSE connectivity.

```tsx
<MeroProvider
  mode={AppMode.SingleContext}    // required
  packageName="com.calimero.my-app"  // for package-based apps
  timeoutMs={30000}                  // optional, default 30s
>
  {children}
</MeroProvider>
```

Props (`MeroProviderConfig & { children }`):

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `mode` | `AppMode` | Yes | `SingleContext`, `MultiContext`, or `Admin` |
| `packageName` | `string` | No | Package name for registry/node lookup |
| `packageVersion` | `string` | No | Specific version (defaults to latest) |
| `registryUrl` | `string` | No | Registry URL override |
| `timeoutMs` | `number` | No | HTTP request timeout (default 30000) |

Modes and their permissions:

| Mode | Permissions | Use case |
|------|-------------|----------|
| `SingleContext` | `context:execute` | Apps that work with one context |
| `MultiContext` | `context:create`, `context:list`, `context:execute` | Apps managing multiple contexts |
| `Admin` | `admin` | Admin dashboards, dev tools |

Auth flow: when `connectToNode(url)` is called, the provider redirects to the node's auth page. After login, the node redirects back with tokens in the URL hash. The provider processes these once (StrictMode-safe via ref) and sets `isAuthenticated = true`.

Online detection: the provider opens an SSE connection to the node after auth. `isOnline` reflects the SSE connection state — no polling.

### `useMero()`

Access the MeroJs instance, auth state, and actions.

```tsx
const {
  mero,             // MeroJs | null — the SDK instance
  isAuthenticated,  // boolean
  isOnline,         // boolean — SSE connection state
  isLoading,        // boolean — initial session restore
  nodeUrl,          // string | null
  applicationId,    // string | null — resolved from auth callback
  contextId,        // string | null — from auth callback
  contextIdentity,  // string | null — executor public key from auth callback
  connectToNode,    // (url: string) => void — starts auth redirect
  logout,           // () => void — clears tokens and state
} = useMero();
```

Through `mero` you access the full MeroJs API:

```tsx
// Admin API (flat methods, NOT nested)
await mero.admin.healthCheck();
await mero.admin.getContexts();
await mero.admin.getContext(contextId);
await mero.admin.getContextIdentitiesOwned(contextId);
await mero.admin.listApplications();
await mero.admin.getApplication(appId);
await mero.admin.installApplication(request);
await mero.admin.createContext(request);
await mero.admin.uploadBlob(request);
await mero.admin.getPeersCount();

// Auth API
await mero.auth.getProviders();
await mero.auth.generateTokens(request);
await mero.auth.refreshToken(request);

// RPC
await mero.rpc.execute({ contextId, method, argsJson, executorPublicKey });

// SSE events
mero.events.connect();
mero.events.subscribe(contextIds);
mero.events.on('event', handler);

// Tokens
mero.getTokenData();        // { access_token, refresh_token, expires_at } | null
mero.isAuthenticated();     // boolean
```

### `useExecute(contextId, executorId)`

Wraps `mero.rpc.execute()` with loading/error state. Unmount-safe.

```tsx
const { execute, loading, error } = useExecute(contextId, contextIdentity);

// Generic typed
const todos = await execute<Todo[]>('list');
await execute('add', { title: 'Buy milk' });
await execute('toggle', { id: '1' });
```

| Return | Type | Description |
|--------|------|-------------|
| `execute` | `<T>(method, params?) => Promise<T \| null>` | Call a contract method |
| `loading` | `boolean` | Request in flight |
| `error` | `Error \| null` | Last error |

### `useSubscription(contextIds, callback)`

Manages SSE event subscription lifecycle. StrictMode-safe — connects once per MeroJs instance, cleans up on unmount.

```tsx
useSubscription(
  contextId ? [contextId] : [],
  (event) => {
    console.log('Context event:', event.contextId, event.data);
    refreshData();
  },
);
```

| Param | Type | Description |
|-------|------|-------------|
| `contextIds` | `string[]` | Context IDs to subscribe to (empty array = no subscription) |
| `callback` | `(event: SseEventData) => void` | Called on each context event |

The SSE connection is shared — multiple `useSubscription` hooks reuse the same connection. The first one to mount calls `connect()`, subsequent ones just add handlers.

### `useContexts(applicationId?)`

Fetches contexts from the node, optionally filtered by application ID.

```tsx
const { contexts, loading, error, refetch } = useContexts(applicationId);

// contexts: Array<{ contextId: string; applicationId: string }>
```

### Storage helpers

Persist/read node URL, application ID, context ID, and context identity in localStorage.

```tsx
import {
  getNodeUrl, setNodeUrl, clearNodeUrl,
  getApplicationId, setApplicationId, clearApplicationId,
  clearAllStorage,
} from '@calimero-network/mero-react';
```

These are used internally by `MeroProvider` but exported for apps that need direct access.

### Re-exports from mero-js

mero-react re-exports everything from mero-js via `export * from '@calimero-network/mero-js'`. Any new API added to mero-js is automatically available from mero-react — no manual sync needed.

```tsx
// All of these work from a single import
import {
  MeroProvider, useMero, useExecute, useSubscription,  // react
  MeroJs, RpcClient, SseClient, WsClient,              // core
  parseAuthCallback, buildAuthLoginUrl,                  // auth helpers
  LocalStorageTokenStore, MemoryTokenStore,              // token stores
} from '@calimero-network/mero-react';
```

## Enums

```tsx
AppMode.SingleContext   // 'single-context'
AppMode.MultiContext    // 'multi-context'
AppMode.Admin           // 'admin'

ConnectionType.RemoteAndLocal  // 'remote-and-local'
ConnectionType.Remote          // 'remote'
ConnectionType.Local           // 'local'
ConnectionType.Custom          // 'custom'
```

## Types

```tsx
import type {
  MeroContextValue,        // useMero() return type
  MeroProviderConfig,      // MeroProvider props (without children)
  MeroProviderProps,       // MeroProvider props (with children)
  CustomConnectionConfig,  // { type: ConnectionType.Custom, url: string }
  AppContext,              // { contextId, executorId, applicationId }
  ExecutionResult,         // { success, result?, error? }
  ApplicationContextRecord,// { contextId, applicationId }
  ContextDiscoveryOptions, // options for useContextDiscovery
  ContextDiscoveryState,   // return type of useContextDiscovery
} from '@calimero-network/mero-react';
```

## Full exports list

```
// Provider & context (mero-react)
MeroProvider, useMero, MeroContext

// Components (mero-react)
ConnectButton, LoginModal

// Enums (mero-react)
AppMode, ConnectionType

// Hooks (mero-react)
useExecute, useSubscription
useContexts, useApplicationContexts, useContextGroup, useContextDiscovery
useCreateContext, useDeleteContext, useJoinContext
useGroupInfo, useGroupMembers, useGroupContexts, useGroupInvitations, useGroupCapabilities
useJoinGroup, useDeleteGroup, useAddGroupMembers, useRemoveGroupMembers
useSyncGroup, useNestGroup, useUnnestGroup, useSubgroups
useUpgradeGroup, useGroupUpgradeStatus, useRetryGroupUpgrade
useRegisterGroupSigningKey, useUpdateGroupSettings
useSetGroupAlias, useSetMemberAlias, useUpdateMemberRole
useSetDefaultCapabilities, useSetDefaultVisibility, useSetTeeAdmissionPolicy
useDetachContextFromGroup
useNamespaces, useNamespace, useNamespaceGroups, useNamespaceIdentity
useNamespacesForApplication, useCreateNamespace, useDeleteNamespace
useJoinNamespace, useCreateNamespaceInvitation, useCreateGroupInNamespace

// Types (mero-react)
MeroContextValue, MeroProviderConfig, MeroProviderProps
CustomConnectionConfig, AppContext, ExecutionResult
ApplicationContextRecord, ContextDiscoveryOptions, ContextDiscoveryState

// Storage (mero-react)
localStorageTokenStorage
getNodeUrl, setNodeUrl, clearNodeUrl
getApplicationId, setApplicationId, clearApplicationId
getContextId, setContextId, clearContextId
getContextIdentity, setContextIdentity, clearContextIdentity
clearAllStorage

// Everything from @calimero-network/mero-js (auto re-exported)
MeroJs, createMeroJs, MeroJsConfig, TokenData
RpcClient, RpcError, ExecuteParams
SseClient, SseEventData, WsClient, WsEventData
AuthApiClient, AdminApiClient
LocalStorageTokenStore, MemoryTokenStore, TokenStore
parseAuthCallback, buildAuthLoginUrl, AuthCallbackResult, AuthLoginOptions
WebHttpClient, HttpClient, HTTPError
// ...and all other mero-js exports
```

## License

MIT
