import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { LoginModal } from './LoginModal';
import type { MeroTheme } from '../theme';

interface FlatArgs {
  /**
   * Story-only: which `cloud` prop the modal gets. `default` passes none (the
   * modal sources its own Cloud tab), `off` passes `false` (node dialog only),
   * `custom` passes an object built from `note` / `walletUrl` below.
   */
  cloud?: 'default' | 'off' | 'custom';
  /** Story-only: the tab the modal opens on. */
  initialTab?: 'node' | 'cloud';
  /** Story-only: a note from the last enrolment, shown on the Cloud tab. */
  note?: string;
  /** Story-only: a wallet override, shown as a hint on the Cloud tab. */
  walletUrl?: string;
  primary?: string;
  primaryHover?: string;
  primaryText?: string;
  background?: string;
  backgroundSecondary?: string;
  border?: string;
  text?: string;
  textSecondary?: string;
  error?: string;
  overlay?: string;
  radius?: string;
}

const colorArg = { control: 'color' as const };

function buildTheme(args: FlatArgs): MeroTheme | undefined {
  const t: Record<string, string> = {};
  (
    [
      'primary',
      'primaryHover',
      'primaryText',
      'background',
      'backgroundSecondary',
      'border',
      'text',
      'textSecondary',
      'error',
      'overlay',
      'radius',
    ] as const
  ).forEach((k) => {
    if (args[k]) t[k] = args[k] as string;
  });
  return Object.keys(t).length ? (t as MeroTheme) : undefined;
}

const meta: Meta<FlatArgs> = {
  title: 'Components/LoginModal',
  component: LoginModal as never,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Modal rendered via React Portal at `document.body`. Stories keep it open by default; close + reopen toggles the open prop, useful for testing the close button + backdrop click.',
      },
    },
  },
  argTypes: {
    primary: { ...colorArg, description: 'Theme: primary / accent CTA colour' },
    primaryHover: { ...colorArg, description: 'Theme: primary on hover' },
    primaryText: { ...colorArg, description: 'Theme: text on top of primary' },
    background: { ...colorArg, description: 'Theme: modal surface' },
    backgroundSecondary: { ...colorArg, description: 'Theme: input + chip surface' },
    border: { ...colorArg, description: 'Theme: border colour' },
    text: { ...colorArg, description: 'Theme: primary text' },
    textSecondary: { ...colorArg, description: 'Theme: muted text' },
    error: { ...colorArg, description: 'Theme: error / danger' },
    overlay: { ...colorArg, description: 'Theme: modal backdrop' },
    radius: {
      control: 'text',
      description: 'Theme: border radius (e.g. 8px, 999px)',
    },
  },
  render: (args) => {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ minHeight: '90vh' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            top: 12,
            right: 12,
            padding: '6px 10px',
            background: '#161b22',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Reopen
        </button>
        <LoginModal
          isOpen={open}
          onConnect={(url) => {
            console.info('[LoginModal] onConnect →', url);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          theme={buildTheme(args)}
          cloud={
            args.cloud === 'off'
              ? false
              : args.cloud === 'custom'
                ? {
                    onEnrol: () => console.info('[LoginModal] cloud.onEnrol'),
                    note: args.note ?? null,
                    walletUrl: args.walletUrl,
                    customWallet: Boolean(args.walletUrl),
                  }
                : undefined
          }
          initialTab={args.initialTab}
        />
      </div>
    );
  },
};
export default meta;

type Story = StoryObj<FlatArgs>;

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Two tabs by default: **Node** (selected) and **Cloud**, the latter sourced by the modal itself from `useAccountEnrolment`, so an app that mounts `LoginModal` gets account sign-in with nothing wired. The Node tab probes the well-known local ports (2428, 2429, 2528, 2529) at `/admin-api/health` as soon as it opens: with one or more nodes up, each is offered as a radio choice alongside an always-present "enter URL manually" option; with nothing running it shows "No local node found" and falls through to the URL field. Use the toolbar "Rescan" link after starting a node.',
      },
    },
  },
};

export const NodeOnly: Story = {
  args: { cloud: 'off' },
  parameters: {
    docs: {
      description: {
        story:
          '`cloud={false}`: no tabs, the node dialog exactly as it was before there was a Cloud tab. For an app that has its own account path, or none.',
      },
    },
  },
};

export const Pink: Story = {
  args: {
    primary: '#ff4081',
    primaryHover: '#e91e63',
    primaryText: '#ffffff',
  },
};

export const Blue: Story = {
  args: {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryText: '#ffffff',
  },
};

export const Pill: Story = {
  args: { radius: '999px' },
};

export const FullCustom: Story = {
  args: {
    primary: '#fbbf24',
    primaryHover: '#f59e0b',
    primaryText: '#1a0a00',
    background: '#1c1917',
    backgroundSecondary: '#292524',
    border: '#44403c',
    text: '#fafaf9',
    textSecondary: '#a8a29e',
    radius: '12px',
  },
  parameters: {
    docs: {
      description: {
        story: 'Every theme token overridden — warm amber with stone surfaces.',
      },
    },
  },
};

export const WithCloudTab: Story = {
  args: { cloud: 'custom' },
  parameters: {
    docs: {
      description: {
        story:
          'A `cloud` object supplied by the caller: the same two tabs, with the Cloud tab rendering the caller\'s enrolment verbatim instead of the modal\'s own. This is what `ConnectButton` passes, from its own `useAccountEnrolment()`.',
      },
    },
  },
};

export const CloudTab: Story = {
  args: {
    cloud: 'custom',
    initialTab: 'cloud',
    walletUrl: 'http://localhost:8090/account-enroll',
    note:
      'Signed in, with nowhere to write yet: a new account is a member of nothing, so no node serves it.',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Opened on the Cloud tab, as `ConnectButton` does when the page comes back from the wallet: the note from the enrolment, and the hint shown when an app points enrolment at a non-hosted wallet.',
      },
    },
  },
};
