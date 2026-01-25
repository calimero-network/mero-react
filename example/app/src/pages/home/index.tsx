import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Button,
  Input,
  Table,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
  Grid,
  GridItem,
  Menu,
  MenuItem,
  MenuGroup,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  useToast,
  CopyToClipboard,
  Text,
} from '@calimero-network/mero-ui';
import { Trash } from '@calimero-network/mero-icons';
import translations from '../../constants/en.global.json';
import { useNavigate } from 'react-router-dom';
import {
  useMero,
  ConnectButton,
  ConnectionType,
  clearAllStorage,
} from '@calimero-network/mero-react';
import { createKvClient, AbiClient, AppContext } from '../../features/kv/api';

export default function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated, mero, nodeUrl, contextId, logout } = useMero();
  const { show } = useToast();
  const [key, setKey] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [entries, setEntries] = useState<any[]>([]);
  const [api, setApi] = useState<AbiClient | null>(null);
  const [currentContext, setCurrentContext] = useState<AppContext | null>(null);
  const loadingEntriesRef = useRef<boolean>(false);
  const initializingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Create API client when mero is available and authenticated
  useEffect(() => {
    if (!mero || !isAuthenticated) return;
    if (initializingRef.current) return; // Prevent double-init in Strict Mode
    initializingRef.current = true;

    const initializeApi = async () => {
      try {
        // Pass the contextId from auth flow to use the correct context
        const { client, context } = await createKvClient(mero, contextId);
        setApi(client);
        setCurrentContext(context);
      } catch (error) {
        console.error('Failed to create API client:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        console.error('API client initialization failed:', errorMessage);
        initializingRef.current = false; // Reset on error to allow retry
      }
    };

    initializeApi();
  }, [mero, isAuthenticated, contextId]);

  const getEntries = useCallback(async () => {
    if (loadingEntriesRef.current || !api) return;
    loadingEntriesRef.current = true;
    try {
      const data = await api.entries();
      const entriesArray = Object.entries(data || {}).map(([k, v]) => ({
        key: k,
        value: v,
      }));
      setEntries(entriesArray);
    } catch (error) {
      console.error('getEntries error:', error);
      // Only show error toast if it's not a "method not found" error
      // (which indicates the KV store app isn't deployed)
      const errorMessage = error instanceof Error ? error.message : translations.home.errors.loadFailed;
      if (!errorMessage.includes('not found')) {
        show({
          title: errorMessage,
          variant: 'error',
        });
      }
    } finally {
      loadingEntriesRef.current = false;
    }
  }, [api, show]);

  const setEntry = useCallback(async () => {
    if (!api) return;
    try {
      await api.set({ key, value });
      await getEntries();
      show({
        title: `Successfully added entry: ${key}`,
        variant: 'success',
      });
      setKey('');
      setValue('');
    } catch (error) {
      console.error('setEntry error:', error);
      const errorMessage = error instanceof Error ? error.message : translations.home.errors.setFailed;
      show({
        title: errorMessage.includes('not found')
          ? 'KV Store app not deployed on this context'
          : errorMessage,
        variant: 'error',
      });
    }
  }, [api, key, value, getEntries, show]);

  const resetEntries = useCallback(async () => {
    if (!api) return;
    try {
      await api.clear();
      await getEntries();
      show({
        title: 'All entries cleared successfully',
        variant: 'success',
      });
    } catch (error) {
      console.error('resetEntries error:', error);
      show({
        title:
          error instanceof Error
            ? error.message
            : translations.home.errors.clearFailed,
        variant: 'error',
      });
    }
  }, [api, getEntries, show]);

  const handleRemoveEntry = useCallback(
    async (entryKey: string) => {
      if (!api) return;
      try {
        await api.remove({ key: entryKey });
        await getEntries();
        show({
          title: `Successfully removed entry: ${entryKey}`,
          variant: 'success',
        });
      } catch (error) {
        console.error('removeEntry error:', error);
        show({
          title:
            error instanceof Error
              ? error.message
              : translations.home.errors.removeFailed,
          variant: 'error',
        });
      }
    },
    [api, getEntries, show],
  );

  useEffect(() => {
    if (isAuthenticated && api) {
      getEntries();
    }
  }, [isAuthenticated, api, getEntries]);

  const doLogout = useCallback(() => {
    logout();
    clearAllStorage();
    window.location.replace('/');
  }, [logout]);

  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="KV Store" />
        <NavbarMenu align="center">
          {currentContext && (
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                alignItems: 'center',
                fontSize: '0.875rem',
                color: '#9ca3af',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Text size="sm" color="muted">
                  Node:
                </Text>
                <Text
                  size="sm"
                  style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                >
                  {(nodeUrl || 'http://node1.127.0.0.1.nip.io')
                    .replace('http://', '')
                    .replace('https://', '')}
                </Text>
                <CopyToClipboard
                  text={nodeUrl || 'http://node1.127.0.0.1.nip.io'}
                  variant="icon"
                  size="small"
                  successMessage="Node URL copied!"
                />
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Text size="sm" color="muted">
                  App ID:
                </Text>
                <Text
                  size="sm"
                  style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                >
                  {currentContext.applicationId.slice(0, 8)}...
                  {currentContext.applicationId.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={currentContext.applicationId}
                  variant="icon"
                  size="small"
                  successMessage="Application ID copied!"
                />
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Text size="sm" color="muted">
                  Context ID:
                </Text>
                <Text
                  size="sm"
                  style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                >
                  {currentContext.contextId.slice(0, 8)}...
                  {currentContext.contextId.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={currentContext.contextId}
                  variant="icon"
                  size="small"
                  successMessage="Context ID copied!"
                />
              </div>
            </div>
          )}
        </NavbarMenu>
        <NavbarMenu align="right">
          {isAuthenticated ? (
            <Menu variant="compact" size="md">
              <MenuGroup>
                <MenuItem onClick={doLogout}>
                  {translations.home.logout}
                </MenuItem>
              </MenuGroup>
            </Menu>
          ) : (
            <NavbarItem>
              <ConnectButton
                connectionType={{
                  type: ConnectionType.Custom,
                  url: 'http://node1.127.0.0.1.nip.io',
                }}
              />
            </NavbarItem>
          )}
        </NavbarMenu>
      </MeroNavbar>
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#111111',
          color: 'white',
        }}
      >
        <Grid
          columns={1}
          gap={32}
          maxWidth="100%"
          justify="center"
          align="center"
          style={{
            minHeight: '100vh',
            padding: '2rem',
          }}
        >
          <GridItem>
            <main
              style={{
                width: '100%',
                maxWidth: '1200px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ maxWidth: '800px', width: '100%' }}>
                <Card variant="rounded" style={{ marginBottom: '2rem' }}>
                  <CardHeader>
                    <CardTitle>{translations.home.addEntry}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setEntry();
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1.5rem',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: '1rem',
                          width: '100%',
                        }}
                      >
                        <Input
                          type="text"
                          placeholder={translations.home.key}
                          value={key}
                          onChange={(e) => setKey(e.target.value)}
                          style={{ width: '100%' }}
                        />
                        <Input
                          type="text"
                          placeholder={translations.home.value}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: '1rem',
                          width: '100%',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Button
                          type="submit"
                          variant="success"
                          style={{
                            flex: 1,
                            minHeight: '3rem',
                          }}
                        >
                          {translations.home.setEntry}
                        </Button>
                        <Button
                          variant="error"
                          onClick={resetEntries}
                          style={{
                            flex: 1,
                            minHeight: '3rem',
                          }}
                        >
                          {translations.home.resetEntries}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
                <Card variant="rounded" style={{ width: '100%' }}>
                  <CardHeader>
                    <CardTitle>Key-Value Entries</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {entries.length === 0 ? (
                      <div
                        style={{
                          color: '#aaa',
                          textAlign: 'center',
                          padding: '3rem 2rem',
                          fontSize: '1.1rem',
                          fontStyle: 'italic',
                        }}
                      >
                        {translations.home.noEntries}
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <Table
                          columns={[
                            { title: translations.home.key, key: 'key' },
                            { title: translations.home.value, key: 'value' },
                            {
                              key: 'actions',
                              title: 'Actions',
                              render: (_value: any, row: any) => (
                                <Button
                                  variant="error"
                                  onClick={() => handleRemoveEntry(row.key)}
                                  style={{
                                    padding: '8px 12px',
                                    minWidth: 'auto',
                                    borderRadius: '6px',
                                  }}
                                >
                                  <Trash size={16} />
                                </Button>
                              ),
                              width: 120,
                              align: 'center',
                            },
                          ]}
                          data={entries}
                          zebra
                          compact
                          stickyHeader
                          style={{
                            minWidth: '100%',
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </main>
          </GridItem>
        </Grid>
      </div>
    </>
  );
}
