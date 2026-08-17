/**
 * Live cursors on one Calimero context — the ephemeral-presence surface running
 * in a real browser.
 *
 * Everything on screen is produced by three local builds and nothing else:
 * `useEphemeral` (this repo, aliased to ../../src), `mero.ephemeral` from the
 * sibling mero-js checkout, and two `merod` nodes.
 *
 * Point each browser window at a DIFFERENT node:
 *
 *   http://localhost:5273/?node=http://localhost:8940&label=node-1
 *   http://localhost:5273/?node=http://localhost:8941&label=node-2
 *
 * Presence is keyed by the NODE's context member key, so two windows on the
 * same node share one author slot and overwrite each other.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MeroJs } from '@calimero-network/mero-js';
import { MeroContext } from '@calimero-network/mero-react';
import { useEphemeral } from '@calimero-network/mero-react';
import type { MeroContextValue } from '@calimero-network/mero-react';

/** The presence slice this app publishes. Opaque bytes to the node. */
interface Cursor {
  x: number;
  y: number;
  label: string;
}

/** How an author FIRST arrived on this page's subscription.
 *
 * `ageMs` is the whole tell and it comes from the node: it is present only on
 * the replay a new subscriber is seeded with, and absent on a live delta. This
 * is read off the raw `mero.ephemeral.subscribe` wire rather than inferred from
 * a timer, because absent and `0` are different answers and only the wire
 * distinguishes them. */
interface Origin {
  seeded: boolean;
  /** The node's own staleness figure at arrival — only set when seeded. */
  arrivalAgeMs?: number;
}

const params = new URLSearchParams(window.location.search);
const NODE_URL = params.get('node') ?? 'http://localhost:8940';
const NODE_LABEL = params.get('label') ?? NODE_URL;
const CONTEXT_PARAM = params.get('context');

export function App(): React.ReactElement {
  const mero = useMemo(() => new MeroJs({ baseUrl: NODE_URL }), []);
  const [contextId, setContextId] = useState<string | null>(CONTEXT_PARAM);
  const [bootError, setBootError] = useState<string | null>(null);

  // Discover the per-run context off the node itself, so no id has to be pasted
  // into a URL. This is also the first cross-origin request the page makes —
  // if merod's CORS were not permissive, the app would die right here.
  useEffect(() => {
    if (contextId) return;
    let cancelled = false;
    fetch(`${NODE_URL}/admin-api/contexts`)
      .then((r) => r.json())
      .then((body: { data?: { contexts?: Array<{ id: string }> } }) => {
        if (cancelled) return;
        const id = body.data?.contexts?.[0]?.id ?? null;
        if (!id) throw new Error('node reports no contexts');
        setContextId(id);
      })
      .catch((e: unknown) => {
        if (!cancelled) setBootError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [contextId]);

  return (
    <MeroContext.Provider value={{ mero } as unknown as MeroContextValue}>
      {bootError ? (
        <pre data-testid="boot-error">{bootError}</pre>
      ) : contextId ? (
        <Stage mero={mero} contextId={contextId} />
      ) : (
        <p data-testid="booting">discovering context on {NODE_URL}…</p>
      )}
    </MeroContext.Provider>
  );
}

function Stage({ mero, contextId }: { mero: MeroJs; contextId: string }): React.ReactElement {
  const { peers, setPresence, ageOf, error } = useEphemeral<Cursor>(contextId);
  const [origins, setOrigins] = useState<Map<string, Origin>>(new Map());
  const [events, setEvents] = useState(0);
  const [self, setSelf] = useState<{ x: number; y: number } | null>(null);
  const [, setTick] = useState(0);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // A second, RAW subscription alongside the hook's — same SSE stream, no extra
  // transport — purely to record whether each author's first entry carried
  // `ageMs`. The hook deliberately folds that into `ageOf`, which cannot say
  // "no age information was sent"; this app wants to show the difference.
  useEffect(() => {
    const ephemeral = (
      mero as unknown as {
        ephemeral?: {
          subscribe: (
            ctx: string,
            h: (e: { author: string; removed?: boolean; ageMs?: number }) => void,
          ) => () => void;
        };
      }
    ).ephemeral;
    if (!ephemeral) return;
    const seen = new Map<string, Origin>();
    return ephemeral.subscribe(contextId, (entry) => {
      setEvents((n) => n + 1);
      if (entry.removed) {
        if (seen.delete(entry.author)) setOrigins(new Map(seen));
        return;
      }
      if (seen.has(entry.author)) return;
      seen.set(entry.author, {
        seeded: entry.ageMs !== undefined,
        arrivalAgeMs: entry.ageMs,
      });
      setOrigins(new Map(seen));
    });
  }, [mero, contextId]);

  // Re-render on a timer so the displayed ages advance.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const x = Math.round(e.clientX - (rect?.left ?? 0));
    const y = Math.round(e.clientY - (rect?.top ?? 0));
    setSelf({ x, y });
    // The hook throttles this at 30ms on the trailing edge — a mousemove storm
    // collapses to ~33 publishes/second carrying the newest position.
    setPresence({ x, y, label: NODE_LABEL });
  };

  return (
    <div style={styles.page}>
      <Header contextId={contextId} events={events} peerCount={peers.size} />
      {error && (
        <pre data-testid="hook-error" style={styles.error}>
          {error.message}
        </pre>
      )}
      <div
        ref={stageRef}
        data-testid="stage"
        style={styles.stage}
        onMouseMove={onMouseMove}
      >
        <p style={styles.hint}>
          move the mouse — this window publishes as <strong>{NODE_LABEL}</strong>
        </p>
        <span data-testid="self-pos" style={styles.selfPos}>
          {self ? `${self.x},${self.y}` : 'no local cursor yet'}
        </span>
        {/* The local cursor, drawn from what THIS window published. It is not a
            peer — `useEphemeral` filters your own author out of `peers` — but
            without it a screenshot shows only the remote arrow, since the real
            pointer is not captured in a screenshot. */}
        {self && (
          <div
            data-testid="self-cursor"
            style={{ ...styles.cursor, left: self.x, top: self.y }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" style={styles.arrow}>
              <path
                d="M2 2 L2 14 L6 10.5 L8.5 16 L11 15 L8.5 9.5 L13.5 9.5 Z"
                fill="#6ea8fe"
                stroke="#111"
                strokeWidth="1"
              />
            </svg>
            <span
              style={{ ...styles.tag, background: '#6ea8fe', border: '2px solid #1c3f7c' }}
            >
              <strong>you</strong> · {NODE_LABEL}
            </span>
          </div>
        )}
        {[...peers.entries()].map(([author, cursor]) => (
          <PeerCursor
            key={author}
            author={author}
            cursor={cursor}
            ageMs={ageOf(author)}
            origin={origins.get(author)}
          />
        ))}
      </div>
    </div>
  );
}

function PeerCursor({
  author,
  cursor,
  ageMs,
  origin,
}: {
  author: string;
  cursor: Cursor;
  ageMs: number | undefined;
  origin: Origin | undefined;
}): React.ReactElement {
  const seeded = origin?.seeded === true;
  return (
    <div
      data-testid="peer-cursor"
      data-author={author}
      data-x={cursor.x}
      data-y={cursor.y}
      data-origin={seeded ? 'seed' : 'live'}
      data-arrival-age-ms={origin?.arrivalAgeMs ?? ''}
      data-age-ms={ageMs ?? ''}
      style={{ ...styles.cursor, left: cursor.x, top: cursor.y }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" style={styles.arrow}>
        <path
          d="M2 2 L2 14 L6 10.5 L8.5 16 L11 15 L8.5 9.5 L13.5 9.5 Z"
          fill={seeded ? '#e8a33d' : '#3ddc84'}
          stroke="#111"
          strokeWidth="1"
        />
      </svg>
      <span
        style={{
          ...styles.tag,
          background: seeded ? '#e8a33d' : '#3ddc84',
          border: seeded ? '2px dashed #7a4d00' : '2px solid #0d5c31',
        }}
      >
        <strong>{cursor.label ?? '?'}</strong> {author.slice(0, 8)}…{' '}
        <span data-testid="peer-origin">{seeded ? 'SEED' : 'LIVE'}</span>
        {seeded && origin?.arrivalAgeMs !== undefined
          ? ` (arrived ${origin.arrivalAgeMs}ms stale)`
          : ''}{' '}
        · age <span data-testid="peer-age">{ageMs ?? '—'}</span>ms
      </span>
    </div>
  );
}

/** Reads `contextStateHash` off the node's admin API once a second.
 *
 * The falsifiable claim: presence does not append DAG ops, so this must sit
 * perfectly still while thousands of cursor updates fly past the counter next
 * to it. An unreachable node reads UNREADABLE rather than a comfortable-looking
 * frozen hash. */
function Header({
  contextId,
  events,
  peerCount,
}: {
  contextId: string;
  events: number;
  peerCount: number;
}): React.ReactElement {
  const [hash, setHash] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  const [unreadable, setUnreadable] = useState(false);
  const hashRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${NODE_URL}/admin-api/contexts/${contextId}`);
        const body = (await r.json()) as { data?: { contextStateHash?: string } };
        const next = body.data?.contextStateHash ?? null;
        if (cancelled || !next) return;
        setUnreadable(false);
        if (hashRef.current !== null && hashRef.current !== next) {
          setChanges((n) => n + 1);
        }
        hashRef.current = next;
        setHash(next);
      } catch {
        if (!cancelled) setUnreadable(true);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [contextId]);

  return (
    <header style={styles.header}>
      <span>
        node <strong data-testid="node-label">{NODE_LABEL}</strong> ({NODE_URL})
      </span>
      <span>
        context <code data-testid="context-id">{contextId}</code>
      </span>
      <span>
        contextStateHash{' '}
        <code data-testid="state-hash">{unreadable ? 'UNREADABLE' : (hash ?? '…')}</code>{' '}
        (<span data-testid="hash-changes">{changes}</span> changes)
      </span>
      <span>
        presence events <span data-testid="presence-events">{events}</span> · peers{' '}
        <span data-testid="peer-count">{peerCount}</span>
      </span>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    margin: 0,
    color: '#e6e6e6',
    background: '#14161a',
    minHeight: '100vh',
  },
  header: {
    display: 'flex',
    gap: 18,
    flexWrap: 'wrap',
    padding: '8px 12px',
    borderBottom: '1px solid #2c313a',
    background: '#0e1013',
  },
  stage: {
    position: 'relative',
    height: 'calc(100vh - 60px)',
    overflow: 'hidden',
    cursor: 'crosshair',
  },
  hint: { position: 'absolute', top: 12, left: 12, opacity: 0.55, margin: 0 },
  selfPos: { position: 'absolute', bottom: 12, left: 12, opacity: 0.55 },
  cursor: { position: 'absolute', transform: 'translate(-2px, -2px)', pointerEvents: 'none' },
  arrow: { display: 'block' },
  tag: {
    position: 'absolute',
    top: 16,
    left: 12,
    whiteSpace: 'nowrap',
    color: '#101010',
    padding: '2px 6px',
    borderRadius: 4,
  },
  error: { color: '#ff8080', padding: '6px 12px', margin: 0 },
};
