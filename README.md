# @calimero-network/mero-react

React bindings for [MeroJs](https://github.com/calimero-network/mero-js) - the official Calimero Network SDK.

## Features

- **MeroProvider** - React Context provider that manages MeroJs instance
- **useMero** - Hook to access MeroJs and authentication state
- **ConnectButton** - Ready-to-use connection button component
- **LoginModal** - Modal for node selection (local/remote)
- **localStorage TokenStorage** - Built-in token persistence

## Installation

```bash
npm install @calimero-network/mero-react @calimero-network/mero-js
# or
pnpm add @calimero-network/mero-react @calimero-network/mero-js
```

## Quick Start

```tsx
import { MeroProvider, ConnectButton, useMero, AppMode } from '@calimero-network/mero-react';

function App() {
  return (
    <MeroProvider
      mode={AppMode.SingleContext}
      packageName="my-app"
    >
      <MyApp />
    </MeroProvider>
  );
}

function MyApp() {
  const { mero, isAuthenticated, isLoading } = useMero();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <ConnectButton />
      
      {isAuthenticated && mero && (
        <Dashboard mero={mero} />
      )}
    </div>
  );
}

function Dashboard({ mero }) {
  const [contexts, setContexts] = useState([]);

  useEffect(() => {
    // Access MeroJs APIs through the mero instance
    mero.admin.contexts.listContexts()
      .then(response => setContexts(response.contexts));
  }, [mero]);

  return (
    <ul>
      {contexts.map(ctx => (
        <li key={ctx.contextId}>{ctx.contextId}</li>
      ))}
    </ul>
  );
}
```

## Provider Configuration

```tsx
<MeroProvider
  // Required: Application mode
  mode={AppMode.SingleContext | AppMode.MultiContext | AppMode.Admin}
  
  // Package-based (recommended)
  packageName="@my-org/my-app"
  packageVersion="1.0.0"  // optional, defaults to latest
  registryUrl="https://registry.calimero.network"  // optional
  
  // OR Legacy: Application ID
  applicationId="app-hash-id"
  applicationPath="/my-app"
  
  // Optional
  eventStreamMode={EventStreamMode.WebSocket | EventStreamMode.SSE}
  timeoutMs={30000}
>
  {children}
</MeroProvider>
```

## Application Modes

| Mode | Permissions | Use Case |
|------|-------------|----------|
| `SingleContext` | `context:execute` | Apps that work with one context |
| `MultiContext` | `context:create`, `context:list`, `context:execute` | Apps managing multiple contexts |
| `Admin` | `admin` | Admin dashboards, dev tools |

## useMero Hook

```tsx
const {
  mero,           // MeroJs instance (null if not connected)
  isAuthenticated, // Whether user is logged in
  isOnline,       // Whether connection is healthy
  isLoading,      // Initial loading state
  nodeUrl,        // Current node URL
  applicationId,  // Resolved application ID
  connectToNode,  // Connect to a node URL and start auth
  logout,         // Clear session
} = useMero();
```

## Connect Button

```tsx
import { ConnectButton, ConnectionType } from '@calimero-network/mero-react';

// Default: shows local/remote options
<ConnectButton />

// Only remote
<ConnectButton connectionType={ConnectionType.Remote} />

// Only local
<ConnectButton connectionType={ConnectionType.Local} />

// Custom URL (skip modal)
<ConnectButton connectionType={{ type: ConnectionType.Custom, url: 'https://my-node.com' }} />
```

## Styling

The components come with default styles. You can override them by:

1. **CSS Variables**:
```css
:root {
  --mero-bg: #1a1a2e;
  --mero-text: #eaeaea;
  --mero-accent: #7b68ee;
  --mero-success: #a8e640;
  --mero-error: #ff4d4d;
  /* ... see styles.css for all variables */
}
```

2. **Custom Classes**:
```tsx
<ConnectButton className="my-custom-button" />
```

3. **Replace Components**: Create your own using `useMero()` hook.

## Storage

Built-in localStorage utilities:

```tsx
import {
  localStorageTokenStorage,
  getNodeUrl,
  setNodeUrl,
  getApplicationId,
  clearAllStorage,
} from '@calimero-network/mero-react';

// localStorageTokenStorage implements MeroJs TokenStorage interface
// It's automatically used by MeroProvider
```

## Accessing MeroJs APIs

All MeroJs APIs are available through the `mero` instance:

```tsx
const { mero } = useMero();

// Admin APIs
await mero.admin.applications.listApplications();
await mero.admin.contexts.createContext({ applicationId, ... });
await mero.admin.blobs.uploadBlob(file);

// Auth APIs
await mero.auth.getHealth();
await mero.auth.refreshToken();

// RPC
await mero.rpc.execute({ contextId, method, args, executorPublicKey });

// WebSocket subscriptions
mero.ws.subscribe(contextId, onEvent);

// SSE subscriptions  
mero.sse.subscribe(contextId, onEvent);
```

## TypeScript

Full TypeScript support:

```tsx
import type {
  MeroContextValue,
  MeroProviderConfig,
  AppContext,
  ExecutionResult,
} from '@calimero-network/mero-react';
```

## License

MIT
