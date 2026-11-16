import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeVerificationState } from '@calimero-network/mero-js';
import {
  ConsentPopupReturn,
  CONSENT_RETURN_MESSAGE,
  CreateWorkspaceDialog,
  useCreateWorkspaceResume,
  type CreatedWorkspace,
} from '../create-workspace';
import { fakeClient, wrapper } from './fake';

const NODE = 'https://node.test';
const RELEASE = { package: 'network.calimero.chat', version: '1.0.0' };
const RETURN_TO = 'http://localhost:3000/';
const INTENT_KEY = 'mero-react:create-workspace-intent';
const verified: NodeVerificationState = {
  status: 'verified',
  url: NODE,
  mock: false,
  release: '2.3.148',
  profile: 'locked-read-only',
  checkedAt: Date.now(),
};
const card = {
  ...RELEASE,
  service: null,
  bundle: 'b'.repeat(64),
  mpk: 'mpk',
  manifestHash: 'mh',
  signer: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  name: 'Mero Chat',
  author: null,
  outbound: [],
  abi: null,
};
const created = { requestId: 'req-1', kind: 'createOrg' as const, decidedAt: 1 };
const approved = { ...created, status: 'approved' as const, outcome: { orgId: 'org-9' } };
const declined = { ...created, status: 'declined' as const };
const pending = { ...created, status: 'pending' as const, decidedAt: 0 };

type Decide = (r: unknown) => void;
let decide: Decide = () => undefined;

function popupWindow() {
  const popup = {
    closed: false,
    close: vi.fn(() => void (popup.closed = true)),
    focus: vi.fn(),
    location: { href: '' },
  };
  return popup;
}
type Popup = ReturnType<typeof popupWindow>;

function setup(me: unknown = { accountId: 'a', app: 'app-1' }, overrides: Record<string, unknown> = {}) {
  const client = fakeClient(
    {
      verification: () => verified,
      verify: async () => verified,
      packageCapabilities: vi.fn(async () => card),
      nodes: [NODE],
      waitForConsent: vi.fn(
        (_id: string, o: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            decide = resolve;
            o.signal.addEventListener('abort', () => resolve(pending));
          }),
      ),
      ...overrides,
    },
    { auth: { me: vi.fn(async () => (me instanceof Error ? Promise.reject(me) : me)) } },
  );
  client.consent.pageCreate.mockResolvedValue({ requestId: 'req-1', url: `${NODE}/consent/req-1`, expiresAt: 9e9, code: 'ABC-123' });
  client.openConsentPage.mockImplementation(async (req: unknown, how?: unknown) => {
    const started = await client.consent.pageCreate({ body: req });
    const options = (typeof how === 'function' ? { navigate: how } : (how ?? {})) as Record<string, (...a: unknown[]) => unknown>;
    if (options.confirm && !(await options.confirm(started))) return started;
    options.navigate?.((started as { url: string }).url);
    return started;
  });
  const onCreated = vi.fn<(w: CreatedWorkspace) => void>();
  const onClose = vi.fn();
  const view = render(<CreateWorkspaceDialog open release={RELEASE} returnTo={RETURN_TO} onCreated={onCreated} onClose={onClose} />, {
    wrapper: wrapper(client),
  });
  return { client, onCreated, onClose, ...view };
}

async function toReview(name = 'My Team', self = 'Ronit') {
  fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: self } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Review before creating' });
}
const createButton = () => screen.getByRole('button', { name: 'Create workspace' }) as HTMLButtonElement;
const readyToCreate = async () => {
  await waitFor(() => expect(createButton().disabled).toBe(false));
};

let popup: Popup | null;
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  popup = popupWindow();
  open = vi.fn(() => popup);
  window.open = open as unknown as typeof window.open;
  window.confirm = vi.fn(() => true);
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  sessionStorage.clear();
  decide = () => undefined;
});
afterEach(() => cleanup());

describe('names step', () => {
  it('asks for both names and keeps them when going back from the review', async () => {
    setup();
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Workspace name') as HTMLInputElement).value).toBe('My Team');
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Ronit');
  });

  it('takes the wording from the labels prop', () => {
    const client = fakeClient();
    render(
      <CreateWorkspaceDialog
        open
        release={RELEASE}
        onCreated={vi.fn()}
        onClose={vi.fn()}
        labels={{ title: 'New server', nameLabel: 'Server name', selfLabel: 'Nickname' }}
      />,
      { wrapper: wrapper(client) },
    );
    expect(screen.getByRole('heading', { name: 'New server' })).toBeTruthy();
    expect(screen.getByLabelText('Server name')).toBeTruthy();
    expect(screen.getByLabelText('Nickname')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    const client = fakeClient();
    render(<CreateWorkspaceDialog open={false} release={RELEASE} onCreated={vi.fn()} onClose={vi.fn()} />, { wrapper: wrapper(client) });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a session bound to the app: approve in a window', () => {
  it('opens the window inside the click, shows the code, and finishes when approved', async () => {
    const { client, onCreated } = setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe('');
    expect(open.mock.calls[0]![2]).toBe('popup,width=480,height=720');
    expect(popup!.location.href).toBe('');
    await screen.findByText('ABC-123');
    expect(screen.getByRole('heading', { name: 'Approve with your passkey' })).toBeTruthy();
    expect(screen.getByText('Waiting for your approval...')).toBeTruthy();
    expect(popup!.location.href).toBe(`${NODE}/consent/req-1`);
    const body = client.consent.pageCreate.mock.calls[0]![0] as { body: { kind: string; returnTo: string; subject: unknown } };
    expect(body.body).toMatchObject({ kind: 'createOrg', returnTo: RETURN_TO });
    expect(JSON.stringify(body.body)).toContain('My Team');
    await act(async () => decide(approved));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orgId: 'org-9', selfName: 'Ronit' }));
    expect(client.orgs.create).not.toHaveBeenCalled();
    expect(popup!.close).toHaveBeenCalled();
  });

  it('finishes at once when the window reports its return, confirming with the node', async () => {
    const { client, onCreated } = setup();
    client.consent.pageResult.mockResolvedValue(approved);
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: CONSENT_RETURN_MESSAGE, requestId: 'req-1', result: 'approved' }, origin: window.location.origin, source: popup as unknown as Window }),
      );
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orgId: 'org-9', selfName: 'Ronit' }));
    expect(client.consent.pageResult).toHaveBeenCalledWith({ request: 'req-1' });
  });

  it('ignores a return message from another origin or window', async () => {
    const { client, onCreated } = setup();
    client.consent.pageResult.mockResolvedValue(approved);
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: CONSENT_RETURN_MESSAGE }, origin: 'https://evil.test', source: popup as unknown as Window }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: CONSENT_RETURN_MESSAGE }, origin: window.location.origin, source: window }));
    });
    expect(client.consent.pageResult).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('goes back to the review with a message when declined', async () => {
    const { onCreated } = setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    await act(async () => decide(declined));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('declined');
    expect(screen.getByRole('heading', { name: 'Review before creating' })).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(popup!.close).toHaveBeenCalled();
  });

  it('goes back to the review when the window is closed without a decision', async () => {
    const { client, onCreated } = setup();
    client.consent.pageResult.mockResolvedValue(pending);
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    popup!.closed = true;
    const alert = await screen.findByRole('alert', undefined, { timeout: 3000 });
    expect(alert.textContent).toContain('closed');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('still finishes when the window closed after the node recorded an approval', async () => {
    const { client, onCreated } = setup();
    client.consent.pageResult.mockResolvedValue(approved);
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    popup!.closed = true;
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orgId: 'org-9', selfName: 'Ronit' }), { timeout: 3000 });
  });

  it('says the request expired when the node never decided', async () => {
    const { onCreated } = setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    await act(async () => decide(pending));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('expired');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows the node error and closes the window when the request is refused', async () => {
    const { client, onCreated } = setup();
    client.consent.pageCreate.mockRejectedValue(new Error('429 RATE_LIMITED: slow down'));
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('429 RATE_LIMITED: slow down');
    expect(popup!.close).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('says so when the approval names no workspace', async () => {
    const { onCreated } = setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    await act(async () => decide({ ...approved, outcome: undefined }));
    expect((await screen.findByRole('alert')).textContent).toContain('no workspace');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('cancels back to the review and closes the window', async () => {
    const { onCreated } = setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('heading', { name: 'Review before creating' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(popup!.close).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('brings the window back with Open the window again', async () => {
    setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await screen.findByText('ABC-123');
    popup!.location.href = 'about:blank';
    fireEvent.click(screen.getByRole('button', { name: 'Open the window again' }));
    expect(popup!.focus).toHaveBeenCalled();
    expect(popup!.location.href).toBe(`${NODE}/consent/req-1`);
  });
});

describe('a session bound to the app: full-page fallback', () => {
  it('redirects, keeping the names, when the window is blocked', async () => {
    const { client } = setup();
    open.mockReturnValue(null);
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await waitFor(() => expect(client.openConsentPage).toHaveBeenCalledTimes(1));
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!)).toEqual({ name: 'My Team', selfName: 'Ronit' });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('ABC-123'));
  });

  it('redirects without trying a window on a narrow screen', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    const { client } = setup();
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await waitFor(() => expect(client.openConsentPage).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();
  });

  it('forgets the names and stays on the review when the person does not go', async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    setup();
    open.mockReturnValue(null);
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await waitFor(() => expect(sessionStorage.getItem(INTENT_KEY)).toBeNull());
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });

  it('shows the node error and forgets the names when the request is refused', async () => {
    const { client } = setup();
    open.mockReturnValue(null);
    client.consent.pageCreate.mockRejectedValue(new Error('500 BOOM: broke'));
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toContain('500 BOOM: broke');
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });
});

describe('a session not bound to an app', () => {
  it('creates the organization directly, with no window', async () => {
    const { client, onCreated } = setup({ accountId: 'a' });
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orgId: 'org-1', selfName: 'Ronit' }));
    expect(client.orgs.create).toHaveBeenCalledWith({ name: 'My Team' });
    expect(open).not.toHaveBeenCalled();
    expect(client.consent.pageCreate).not.toHaveBeenCalled();
  });

  it('treats a node that cannot say as unbound', async () => {
    const { onCreated } = setup(new Error('offline'));
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
  });

  it('shows the node error when creating is refused', async () => {
    const { client, onCreated } = setup({ accountId: 'a' });
    client.orgs.create.mockRejectedValue(new Error('403 FORBIDDEN: not allowed'));
    await toReview();
    await readyToCreate();
    fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toContain('403 FORBIDDEN: not allowed');
    expect(onCreated).not.toHaveBeenCalled();
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });

  it('keeps Create disabled until it is known whether the session is bound', async () => {
    let answer: (v: { accountId: string }) => void = () => undefined;
    const { client } = setup(undefined, {});
    client.auth.me.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    cleanup();
    render(<CreateWorkspaceDialog open release={RELEASE} returnTo={RETURN_TO} onCreated={vi.fn()} onClose={vi.fn()} />, { wrapper: wrapper(client) });
    await toReview();
    expect(createButton().disabled).toBe(true);
    await act(async () => answer({ accountId: 'a' }));
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });
});

describe('resuming after the full-page return', () => {
  const keep = () => sessionStorage.setItem(INTENT_KEY, JSON.stringify({ name: 'My Team', selfName: 'Ronit' }));
  const back = (result = 'approved') => window.history.replaceState({}, '', `/?request_id=req-1&result=${result}`);
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('reads the result from the node and calls onCreated', async () => {
    keep();
    back();
    const client = fakeClient({ resumeConsent: vi.fn(async () => approved) });
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateWorkspaceResume({ onCreated }), { wrapper: wrapper(client) });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orgId: 'org-9', selfName: 'Ronit' }));
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
    expect(result.current.message).toBeNull();
  });

  it('says so when declined', async () => {
    keep();
    back('declined');
    const client = fakeClient({ resumeConsent: vi.fn(async () => declined) });
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateWorkspaceResume({ onCreated }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.message).toContain('declined'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });

  it('shows the node refusal of a return that is not this tab\'s request', async () => {
    keep();
    back();
    const client = fakeClient({ resumeConsent: vi.fn(async () => Promise.reject(new Error('CONSENT_REQUEST_MISMATCH'))) });
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateWorkspaceResume({ onCreated }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.message).toContain('CONSENT_REQUEST_MISMATCH'));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does nothing when the page was not a consent return', async () => {
    keep();
    const resumeConsent = vi.fn(async () => approved);
    const client = fakeClient({ resumeConsent });
    renderHook(() => useCreateWorkspaceResume({ onCreated: vi.fn() }), { wrapper: wrapper(client) });
    await act(async () => undefined);
    expect(resumeConsent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(INTENT_KEY)).not.toBeNull();
  });

  it('does nothing for a return whose intent is gone', async () => {
    back();
    const resumeConsent = vi.fn(async () => approved);
    const onCreated = vi.fn();
    const client = fakeClient({ resumeConsent });
    renderHook(() => useCreateWorkspaceResume({ onCreated }), { wrapper: wrapper(client) });
    await act(async () => undefined);
    expect(resumeConsent).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('ConsentPopupReturn', () => {
  const back = () => window.history.replaceState({}, '', '/?request_id=req-1&result=approved');
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });
  const withOpener = (opener: unknown) => Object.defineProperty(window, 'opener', { value: opener, configurable: true });

  it('tells the opener, closes itself and renders nothing else', () => {
    back();
    const postMessage = vi.fn();
    withOpener({ postMessage, location: { origin: window.location.origin } });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { container } = render(
      <ConsentPopupReturn>
        <p>the app</p>
      </ConsentPopupReturn>,
    );
    expect(container.textContent).toBe('');
    expect(postMessage).toHaveBeenCalledWith({ type: CONSENT_RETURN_MESSAGE, requestId: 'req-1', result: 'approved' }, window.location.origin);
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });

  it('renders the app when this page is not a consent return', () => {
    withOpener({ postMessage: vi.fn(), location: { origin: window.location.origin } });
    render(
      <ConsentPopupReturn>
        <p>the app</p>
      </ConsentPopupReturn>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('renders the app when there is no opener (the full-page return)', () => {
    back();
    render(
      <ConsentPopupReturn>
        <p>the app</p>
      </ConsentPopupReturn>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('renders the app when the opener is another origin', () => {
    back();
    const postMessage = vi.fn();
    withOpener({
      postMessage,
      get location(): never {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    });
    render(
      <ConsentPopupReturn>
        <p>the app</p>
      </ConsentPopupReturn>,
    );
    expect(screen.getByText('the app')).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
