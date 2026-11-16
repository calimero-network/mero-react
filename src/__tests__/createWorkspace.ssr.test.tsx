// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConsentPopupReturn, CreateWorkspaceDialog } from '../create-workspace';
import { MockMeroProvider } from '../test-utils/MockMeroProvider';

describe('create workspace on the server', () => {
  it('renders the names step and the app without touching window', () => {
    expect(typeof window).toBe('undefined');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToString(
      <MockMeroProvider>
        <ConsentPopupReturn>
          <CreateWorkspaceDialog open release={{ package: 'p', version: '1' }} onCreated={() => {}} onClose={() => {}} />
        </ConsentPopupReturn>
      </MockMeroProvider>,
    );
    expect(html).toContain('Workspace name');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
