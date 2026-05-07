import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Divider,
  Flex,
  Input,
  Select,
  Stack,
  Tabs,
  TabPanel,
  Text,
  useToast,
} from '@calimero-network/mero-ui';
import {
  setContextId,
  useContexts,
  useCreateContext,
  useCreateGroupInNamespace,
  useCreateNamespace,
  useMero,
  useNamespacesForApplication,
} from '@calimero-network/mero-react';

// Server accepts one of these values for upgradePolicy. Using a union type
// (rather than a bare string) catches typos at compile time.
type UpgradePolicy = 'Automatic' | 'LazyOnAccess' | 'Coordinated';

// LazyOnAccess is the least disruptive default — upgrades only when accessed.
const UPGRADE_POLICY: UpgradePolicy = 'LazyOnAccess';

// Bytes for an empty JSON object `{}` — passed as the init payload when
// the contract's `init` method takes no arguments. Despite the TS type
// marking `initializationParams` optional, the server rejects requests
// that omit the field. Derived rather than hardcoded so the source of
// the bytes is self-evident.
const EMPTY_INIT_PARAMS: number[] = Array.from(new TextEncoder().encode('{}'));

export default function SelectContext() {
  const navigate = useNavigate();
  const { isAuthenticated, applicationId, contextId } = useMero();
  const { show } = useToast();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
      return;
    }
    // If a context is already chosen, don't show this screen again — bounce
    // straight to /home so users can't accidentally create duplicates by
    // hitting Back.
    if (contextId) navigate('/home');
  }, [isAuthenticated, contextId, navigate]);

  const { contexts, loading: contextsLoading } = useContexts(applicationId);
  const { namespaces, loading: namespacesLoading } =
    useNamespacesForApplication(applicationId);

  const { createNamespace, loading: creatingNamespace } = useCreateNamespace();
  const { createGroupInNamespace, loading: creatingGroup } =
    useCreateGroupInNamespace();
  const { createContext, loading: creatingContext } = useCreateContext();

  const [tab, setTab] = useState<'new' | 'existing'>('new');

  // "New namespace + context" form
  const [namespaceAlias, setNamespaceAlias] = useState('');
  const [newCtxAlias, setNewCtxAlias] = useState('');

  // "Group in existing namespace" form
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [groupAlias, setGroupAlias] = useState('');
  const [groupCtxAlias, setGroupCtxAlias] = useState('');

  useEffect(() => {
    // Sync `selectedNamespace` with the current list:
    // - pick the first namespace when nothing is selected
    // - clear the selection if the previously-chosen namespace is gone
    //   (deleted on another client, refetched, etc.) so we don't try to
    //   create a group inside a stale ID.
    const stillExists = namespaces.some(
      (n) => n.namespaceId === selectedNamespace,
    );
    if (!selectedNamespace && namespaces.length > 0) {
      setSelectedNamespace(namespaces[0].namespaceId);
    } else if (selectedNamespace && !stillExists) {
      setSelectedNamespace(namespaces[0]?.namespaceId ?? '');
    }
  }, [namespaces, selectedNamespace]);

  const namespaceOptions = useMemo(
    () =>
      namespaces.map((n) => ({
        value: n.namespaceId,
        label: n.alias
          ? `${n.alias} (${n.namespaceId.slice(0, 8)}…)`
          : n.namespaceId,
      })),
    [namespaces],
  );

  const busy = creatingNamespace || creatingGroup || creatingContext;

  const finalize = (chosenContextId: string) => {
    setContextId(chosenContextId);
    show({ title: 'Context ready', variant: 'success' });
    // MeroProvider reads contextId from storage on mount, so a hard reload is
    // the simplest way to propagate the new selection. (A live setter on
    // MeroProvider would be cleaner, but is out of scope for the example.)
    window.location.replace('/home');
  };

  // Note: this flow makes three sequential calls (namespace → group →
  // context). If a later call fails, earlier resources stay on the node —
  // no rollback is performed. The user can recover by switching to the
  // "Existing namespace" tab and reusing what was created.
  const createInNewNamespace = async () => {
    if (!applicationId) {
      show({ title: 'No applicationId yet', variant: 'error' });
      return;
    }
    try {
      // Required fields only; alias is omitted when blank (server defaults).
      const ns = await createNamespace({
        applicationId,
        upgradePolicy: UPGRADE_POLICY,
        ...(namespaceAlias && { alias: namespaceAlias }),
      });
      if (!ns) throw new Error('Namespace creation failed');

      // Group request body defaults to {} — root group inside a fresh
      // namespace doesn't need its own alias.
      const group = await createGroupInNamespace(ns.namespaceId, {});
      if (!group) throw new Error('Group creation failed');

      const ctx = await createContext({
        applicationId,
        groupId: group.groupId,
        initializationParams: EMPTY_INIT_PARAMS,
        ...(newCtxAlias && { alias: newCtxAlias }),
      });
      if (!ctx) throw new Error('Context creation failed');

      finalize(ctx.contextId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create context';
      show({ title: msg, variant: 'error' });
    }
  };

  const createInExistingNamespace = async () => {
    if (!applicationId) {
      show({ title: 'No applicationId yet', variant: 'error' });
      return;
    }
    if (!selectedNamespace) {
      show({ title: 'Pick a namespace first', variant: 'error' });
      return;
    }
    try {
      const group = await createGroupInNamespace(
        selectedNamespace,
        groupAlias ? { alias: groupAlias } : {},
      );
      if (!group) throw new Error('Group creation failed');

      const ctx = await createContext({
        applicationId,
        groupId: group.groupId,
        initializationParams: EMPTY_INIT_PARAMS,
        ...(groupCtxAlias && { alias: groupCtxAlias }),
      });
      if (!ctx) throw new Error('Context creation failed');

      finalize(ctx.contextId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create context';
      show({ title: msg, variant: 'error' });
    }
  };

  // Don't flash protected UI before the redirect effect fires.
  if (!isAuthenticated || contextId) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at top, #1c2128 0%, #0d1117 60%, #050709 100%)',
        color: '#e6edf3',
        padding: '4rem 1.5rem',
        boxSizing: 'border-box',
      }}
    >
      <main
        style={{
          maxWidth: 720,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem',
        }}
      >
        <header style={{ textAlign: 'center' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '2rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            Pick a context
          </h1>
          <Text size="sm" color="muted" style={{ marginTop: '0.5rem' }}>
            MultiContext apps let users manage their own contexts. Pick an
            existing one or create a new namespace / group below.
          </Text>
        </header>

        <Card variant="rounded">
          <CardHeader>
            <CardTitle>Existing contexts</CardTitle>
          </CardHeader>
          <CardContent>
            {contextsLoading ? (
              <Text color="muted">Loading…</Text>
            ) : contexts.length === 0 ? (
              <Text color="muted">
                You don't have any contexts for this app yet — create one below.
              </Text>
            ) : (
              <Stack spacing="sm">
                {contexts.map((c) => (
                  <Flex
                    key={c.contextId}
                    align="center"
                    justify="space-between"
                    gap="md"
                    style={{
                      padding: '12px 14px',
                      border: '1px solid #30363d',
                      borderRadius: 10,
                      background: '#0d1117',
                    }}
                  >
                    <Text
                      size="sm"
                      style={{ fontFamily: 'monospace', color: '#e6edf3' }}
                    >
                      {c.contextId}
                    </Text>
                    <Button
                      variant="primary"
                      onClick={() => finalize(c.contextId)}
                      style={{
                        backgroundColor: '#A5FF11',
                        color: '#0A0E13',
                        border: 'none',
                      }}
                    >
                      Use
                    </Button>
                  </Flex>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="rounded">
          <CardHeader>
            <CardTitle>Create a new context</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as 'new' | 'existing')}
              tabs={[
                { id: 'new', label: 'New namespace' },
                { id: 'existing', label: 'Existing namespace' },
              ]}
            >
              <TabPanel when="new" active={tab}>
                <Stack spacing="md" style={{ paddingTop: '1rem' }}>
                  <Text size="sm" color="muted">
                    Creates a namespace, a root group inside it, and a context
                    bound to that group.
                  </Text>
                  <Field label="Namespace alias (optional)">
                    <Input
                      placeholder="e.g. my-team"
                      value={namespaceAlias}
                      onChange={(e) => setNamespaceAlias(e.target.value)}
                    />
                  </Field>
                  <Field label="Context alias (optional)">
                    <Input
                      placeholder="e.g. main"
                      value={newCtxAlias}
                      onChange={(e) => setNewCtxAlias(e.target.value)}
                    />
                  </Field>
                  <Divider color="muted" spacing="sm" />
                  <Flex justify="flex-end">
                    <Button
                      variant="primary"
                      disabled={busy || !applicationId}
                      onClick={createInNewNamespace}
                      style={{
                        backgroundColor: '#A5FF11',
                        color: '#0A0E13',
                        border: 'none',
                      }}
                    >
                      {busy ? 'Creating…' : 'Create namespace + context'}
                    </Button>
                  </Flex>
                </Stack>
              </TabPanel>

              <TabPanel when="existing" active={tab}>
                <Stack spacing="md" style={{ paddingTop: '1rem' }}>
                  <Text size="sm" color="muted">
                    Creates a new group inside an existing namespace, plus a
                    context bound to that group.
                  </Text>
                  {namespacesLoading ? (
                    <Text color="muted">Loading namespaces…</Text>
                  ) : namespaces.length === 0 ? (
                    <Text color="muted">
                      No namespaces yet — use the "New namespace" tab first.
                    </Text>
                  ) : (
                    <>
                      <Select
                        label="Namespace"
                        value={selectedNamespace}
                        onChange={setSelectedNamespace}
                        options={namespaceOptions}
                      />
                      <Field label="Group alias (optional)">
                        <Input
                          placeholder="e.g. project-x"
                          value={groupAlias}
                          onChange={(e) => setGroupAlias(e.target.value)}
                        />
                      </Field>
                      <Field label="Context alias (optional)">
                        <Input
                          placeholder="e.g. main"
                          value={groupCtxAlias}
                          onChange={(e) => setGroupCtxAlias(e.target.value)}
                        />
                      </Field>
                      <Divider color="muted" spacing="sm" />
                      <Flex justify="flex-end">
                        <Button
                          variant="primary"
                          disabled={busy || !applicationId || !selectedNamespace}
                          onClick={createInExistingNamespace}
                          style={{
                            backgroundColor: '#A5FF11',
                            color: '#0A0E13',
                            border: 'none',
                          }}
                        >
                          {busy ? 'Creating…' : 'Create group + context'}
                        </Button>
                      </Flex>
                    </>
                  )}
                </Stack>
              </TabPanel>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 13,
        color: '#9ca3af',
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
